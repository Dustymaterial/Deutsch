import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createChatLiveHub, liveSessionValid } from '../server/chatLive.js'

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
