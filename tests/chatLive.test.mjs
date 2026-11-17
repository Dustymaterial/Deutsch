import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import express from 'express'
import { ObjectId } from 'mongodb'
import { createChatLiveHub, liveSessionValid } from '../server/chatLive.js'
import { createCompanionRouter } from '../server/companions.js'

class Response extends EventEmitter {
  chunks = []
  ended = false
  statusCode = 200
  set() { return this }
  flushHeaders() {}
  write(chunk) { this.chunks.push(chunk); return true }
  end() { this.ended = true }
  status(code) { this.statusCode = code; return this }
  json(body) { this.body = body; return this }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('live hints are scoped, reauthorized and coalesced while authorization is pending', async () => {
  const stream = new EventEmitter()
  stream.close = async () => {}
  const hub = createChatLiveHub({ watch: () => stream })
  const req = new EventEmitter()
  const res = new Response()
  let release
  let authorized = true
  let checks = 0
  hub.subscribe(req, res, 'group', 'group-a', async () => {
    checks += 1
    if (checks === 1) await new Promise((resolve) => { release = resolve })
    return authorized
  })
  const change = (groupId) => ({
    ns: { coll: 'groupMessages' }, fullDocument: { groupId }, operationType: 'insert',
  })
  stream.emit('change', change('group-b'))
  assert.equal(checks, 0)
  stream.emit('change', change('group-a'))
  stream.emit('change', change('group-a'))
  stream.emit('change', change('group-a'))
  assert.equal(checks, 1)
  release()
  await tick()
  assert.equal(checks, 2)
  assert.equal(res.chunks.filter((chunk) => chunk.startsWith('event: change')).length, 2)
  authorized = false
  stream.emit('change', change('group-a'))
  await tick()
  assert.equal(res.ended, true)
  assert.equal(res.chunks.filter((chunk) => chunk.startsWith('event: change')).length, 2)
  stream.emit('change', change('group-a'))
  assert.equal(checks, 3)
})

test('read acknowledgements and unmapped deletes do not broadcast hints', () => {
  const stream = new EventEmitter()
  const hub = createChatLiveHub({ watch: () => stream })
  const req = new EventEmitter()
  const res = new Response()
  let checks = 0
  hub.subscribe(req, res, 'group', 'group-a', async () => { checks += 1; return true })
  stream.emit('change', { ns: { coll: 'groupMembers' }, operationType: 'update',
    fullDocument: { groupId: 'group-a' }, updateDescription: { updatedFields: { readThrough: 'x' } } })
  stream.emit('change', { ns: { coll: 'groupMessages' }, operationType: 'delete', documentKey: { _id: 'x' } })
  assert.equal(checks, 0)
  req.emit('close')
  assert.equal(res.ended, true)
})

test('a failed change stream closes subscribers and rejects new subscriptions', () => {
  const stream = new EventEmitter()
  stream.close = async () => {}
  const hub = createChatLiveHub({ watch: () => stream })
  const req = new EventEmitter()
  const res = new Response()
  hub.subscribe(req, res, 'private', 'chat', async () => true)
  const original = console.error
  console.error = () => {}
  try { stream.emit('error', new Error('offline')) } finally { console.error = original }
  assert.equal(res.ended, true)
  const rejected = new Response()
  hub.subscribe(new EventEmitter(), rejected, 'private', 'chat', async () => true)
  assert.equal(rejected.statusCode, 503)
})

test('message sound hints reach only eligible recipients of new messages', async () => {
  const stream = new EventEmitter()
  const conversationId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const groupId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const createdAt = new Date()
  let connected = true
  let members = [{ userId: 'recipient' }]
  const db = {
    watch: () => stream,
    collection(name) {
      if (name === 'companionConversations') return { findOne: async () => ({
        pairKey: 'pair', connectionId: 'connection', participants: ['sender', 'recipient'],
      }) }
      if (name === 'relationships') return { findOne: async () => connected ? {} : null }
      if (name === 'groups') return { findOne: async () => ({}) }
      if (name === 'groupMembers') return { find: () => ({ toArray: async () => members }) }
      throw new Error(`Unexpected collection: ${name}`)
    },
  }
  const hub = createChatLiveHub(db)
  const senderReq = new EventEmitter()
  const recipientReq = new EventEmitter()
  const strangerReq = new EventEmitter()
  const sender = new Response()
  const recipient = new Response()
  const stranger = new Response()
  let allowed = true
  let validSession = true
  hub.subscribeNotifications(senderReq, sender, 'sender', async () => ({ session: true, allowed: true }))
  hub.subscribeNotifications(recipientReq, recipient, 'recipient', async () => ({ session: validSession, allowed }))
  hub.subscribeNotifications(strangerReq, stranger, 'stranger', async () => ({ session: true, allowed: true }))
  const emit = (coll, operationType = 'insert') => stream.emit('change', {
    ns: { coll }, operationType,
    fullDocument: { senderId: 'sender', conversationId, groupId, createdAt, text: 'private content' },
  })
  const count = (res) => res.chunks.filter((chunk) => chunk.startsWith('event: message')).length
  emit('companionMessages')
  await tick()
  assert.equal(count(recipient), 1)
  assert.equal(count(sender), 0)
  assert.equal(count(stranger), 0)
  assert.equal(recipient.chunks.some((chunk) => chunk.includes('private content')), false)
  emit('companionMessages', 'update')
  connected = false
  emit('companionMessages')
  await tick()
  assert.equal(count(recipient), 1)
  emit('groupMessages')
  await tick()
  assert.equal(count(recipient), 2)
  validSession = false
  emit('groupMessages')
  await tick()
  assert.equal(recipient.ended, true)
  assert.equal(count(recipient), 2)
  members = []
  emit('groupMessages')
  await tick()
  allowed = false
  members = [{ userId: 'recipient' }]
  emit('groupMessages')
  await tick()
  assert.equal(count(recipient), 2)
  senderReq.emit('close')
  recipientReq.emit('close')
  strangerReq.emit('close')
})

test('message sound endpoint rechecks membership and session before delivery', async () => {
  const stream = new EventEmitter()
  const me = new ObjectId()
  const sender = new ObjectId().toString()
  const groupId = new ObjectId().toString()
  const createdAt = new Date()
  let active = true
  let session = { userId: me.toString(), sessionVersion: 0 }
  const users = { findOne: async () => ({ emailVerifiedAt: createdAt, groupRulesAcceptedAt: createdAt }) }
  const groups = { findOne: async () => ({}) }
  const groupMembers = {
    find: () => ({ toArray: async () => [{ userId: me.toString() }] }),
    findOne: async () => active ? {} : null,
  }
  const db = { watch: () => stream, collection: (name) => {
    if (name === 'groups') return groups
    if (name === 'groupMembers') return groupMembers
    throw new Error(`Unexpected collection: ${name}`)
  } }
  const requireUser = (req, _res, next) => {
    req.accountUser = { _id: me, emailVerifiedAt: createdAt }
    req.sessionID = 'session'
    req.sessionStore = { get: (_id, callback) => callback(null, session) }
    next()
  }
  const app = express()
  app.use('/companions', createCompanionRouter({
    users, relationships: {}, sharedWords: {}, conversations: {}, companionMessages: {},
    companionReports: {}, chatTyping: {}, groups, groupMembers, requireUser, chatLive: createChatLiveHub(db),
  }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  let reader
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/companions/message-sounds/live`)
    assert.equal(response.status, 200)
    reader = response.body.getReader()
    assert.match(new TextDecoder().decode((await reader.read()).value), /retry:/)
    const change = () => stream.emit('change', {
      ns: { coll: 'groupMessages' }, operationType: 'insert', fullDocument: { groupId, senderId: sender, createdAt },
    })
    change()
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: message/)
    const pending = reader.read()
    let received = false
    void pending.then(() => { received = true })
    active = false
    change()
    await tick()
    assert.equal(received, false)
    active = true
    session = null
    change()
    assert.equal((await pending).done, true)
  } finally {
    if (reader) await reader.cancel().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
  }
})

test('live authorization checks current session, expiry, version and verification', async () => {
  const id = { toString: () => 'user' }
  let session = { userId: 'user', sessionVersion: 1, cookie: { expires: new Date(Date.now() + 10000) } }
  let user = { sessionVersion: 1, emailVerifiedAt: new Date() }
  const req = { accountUser: { _id: id }, sessionID: 'session', sessionStore: { get: (_id, cb) => cb(null, session) } }
  const users = { findOne: async () => user }
  assert.equal(await liveSessionValid(req, users), true)
  session = { ...session, sessionVersion: 0 }
  assert.equal(await liveSessionValid(req, users), false)
  session = { ...session, sessionVersion: 1, cookie: { expires: new Date(0) } }
  assert.equal(await liveSessionValid(req, users), false)
  session = null
  assert.equal(await liveSessionValid(req, users), false)
  session = { userId: 'user', sessionVersion: 1 }
  user = { sessionVersion: 1 }
  assert.equal(await liveSessionValid(req, users), false)
})
