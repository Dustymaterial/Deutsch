import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import { createChatLiveHub } from '../server/chatLive.js'
import { createCompanionRouter } from '../server/companions.js'
import { createGroupsRouter } from '../server/groups.js'

const uri = process.env.CHAT_LIVE_MONGO_URI

test('replica set delivers scoped hints across instances and rechecks access', { skip: !uri, timeout: 20000 }, async () => {
  const clients = [new MongoClient(uri), new MongoClient(uri)]
  await Promise.all(clients.map((client) => client.connect()))
  const name = `deutsch_chat_live_test_${process.pid}`
  const dbs = clients.map((client) => client.db(name))
  const groupObjectId = new ObjectId()
  const groupId = groupObjectId.toString()
  const userIds = [new ObjectId(), new ObjectId()]
  const conversationId = new ObjectId()
  const connectionId = new ObjectId().toString()
  const sessions = userIds.map((id) => ({ userId: id.toString(), sessionVersion: 0 }))
  const servers = []
  const readers = []
  try {
    await dbs[0].collection('users').insertMany(userIds.map((_id) => ({ _id, emailVerifiedAt: new Date() })))
    await dbs[0].collection('groupMembers').insertMany(userIds.map((id) => ({ groupId, userId: id.toString(), state: 'active' })))
    await dbs[0].collection('groups').insertOne({ _id: groupObjectId })
    const participants = userIds.map((id) => id.toString()).sort()
    await dbs[0].collection('relationships').insertOne({ pairKey: participants.join(':'), participants, state: 'connected', blockedBy: [], connectionId })
    await dbs[0].collection('companionConversations').insertOne({ _id: conversationId, participants, connectionId })
    for (let i = 0; i < 2; i += 1) {
      const app = express()
      const hub = createChatLiveHub(dbs[i])
      const users = dbs[i].collection('users')
      const requireUser = (req, _res, next) => {
        req.accountUser = { _id: userIds[i], emailVerifiedAt: new Date() }
        req.sessionID = `session-${i}`
        req.sessionStore = { get: (_id, cb) => cb(null, sessions[i]) }
        next()
      }
      app.use('/groups', createGroupsRouter({
        users, groups: dbs[i].collection('groups'), groupMembers: dbs[i].collection('groupMembers'),
        groupMessages: dbs[i].collection('groupMessages'), groupReports: dbs[i].collection('groupReports'),
        chatTyping: dbs[i].collection('chatTyping'), isModerator: () => false, requireUser, chatLive: hub,
      }))
      app.use('/companions', createCompanionRouter({
        users, relationships: dbs[i].collection('relationships'), sharedWords: dbs[i].collection('sharedWords'),
        conversations: dbs[i].collection('companionConversations'), companionMessages: dbs[i].collection('companionMessages'),
        companionReports: dbs[i].collection('companionReports'), chatTyping: dbs[i].collection('chatTyping'),
        requireUser, chatLive: hub,
      }))
      const server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
      })

      servers.push(server)
      const response = await fetch(`http://127.0.0.1:${server.address().port}/groups/${groupId}/live`)
      assert.equal(response.status, 200)
      readers.push(response.body.getReader())
      assert.match(new TextDecoder().decode((await readers[i].read()).value), /retry:/)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    await dbs[0].collection('groupMessages').insertOne({ groupId, text: 'first' })
    const first = await Promise.all(readers.map((reader) => reader.read()))
    for (const result of first) assert.match(new TextDecoder().decode(result.value), /event: change/)

    await dbs[0].collection('groupMembers').updateOne({ groupId, userId: userIds[1].toString() }, { $set: { state: 'removed' } })
    assert.match(new TextDecoder().decode((await readers[0].read()).value), /event: change/)
    assert.equal((await readers[1].read()).done, true)

    await readers[0].cancel()
    const reconnected = await fetch(`http://127.0.0.1:${servers[0].address().port}/groups/${groupId}/live`)
    const reader = reconnected.body.getReader()
    readers.push(reader)
    assert.match(new TextDecoder().decode((await reader.read()).value), /retry:/)
    await dbs[1].collection('groupMessages').insertOne({ groupId, text: 'after reconnect' })
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: change/)
    sessions[0] = null
    await dbs[1].collection('groupMessages').insertOne({ groupId, text: 'after logout' })
    assert.equal((await reader.read()).done, true)

    sessions[0] = { userId: userIds[0].toString(), sessionVersion: 0 }
    const privateResponse = await fetch(`http://127.0.0.1:${servers[0].address().port}/companions/chats/${conversationId}/live`)
    const privateReader = privateResponse.body.getReader()
    readers.push(privateReader)
    assert.match(new TextDecoder().decode((await privateReader.read()).value), /retry:/)
    await dbs[1].collection('companionMessages').insertOne({ conversationId: conversationId.toString(), text: 'private' })
    assert.match(new TextDecoder().decode((await privateReader.read()).value), /event: change/)
    await dbs[0].collection('relationships').updateOne({ pairKey: participants.join(':') }, { $set: { state: 'none' } })
    await dbs[1].collection('companionMessages').insertOne({ conversationId: conversationId.toString(), text: 'after disconnect' })
    assert.equal((await privateReader.read()).done, true)
  } finally {
    await Promise.all(readers.map((reader) => reader.cancel().catch(() => {})))
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    await dbs[0].dropDatabase()
    await Promise.all(clients.map((client) => client.close()))
  }
})

test('message sound stream delivers incoming private and group messages and rechecks the session', { skip: !uri, timeout: 20000 }, async () => {
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(`deutsch_sound_live_test_${process.pid}`)
  const [me, sender] = [new ObjectId(), new ObjectId()]
  const groupId = new ObjectId()
  const conversationId = new ObjectId()
  const participants = [me.toString(), sender.toString()].sort()
  const connectionId = new ObjectId().toString()
  let session = { userId: me.toString(), sessionVersion: 0 }
  let server
  let reader
  try {
    await db.collection('users').insertOne({ _id: me, emailVerifiedAt: new Date(), groupRulesAcceptedAt: new Date() })
    await db.collection('groups').insertOne({ _id: groupId })
    await db.collection('groupMembers').insertOne({
      groupId: groupId.toString(), userId: me.toString(), state: 'active', joinedAt: new Date(Date.now() - 1000),
    })
    await db.collection('relationships').insertOne({ pairKey: participants.join(':'), participants, state: 'connected', blockedBy: [], connectionId })
    await db.collection('companionConversations').insertOne({ _id: conversationId, pairKey: participants.join(':'), participants, connectionId })
    const app = express()
    const requireUser = (req, _res, next) => {
      req.accountUser = { _id: me, emailVerifiedAt: new Date() }
      req.sessionID = 'session'
      req.sessionStore = { get: (_id, cb) => cb(null, session) }
      next()
    }
    app.use('/companions', createCompanionRouter({
      users: db.collection('users'), relationships: db.collection('relationships'), sharedWords: db.collection('sharedWords'),
      conversations: db.collection('companionConversations'), companionMessages: db.collection('companionMessages'),
      companionReports: db.collection('companionReports'), chatTyping: db.collection('chatTyping'),
      groups: db.collection('groups'), groupMembers: db.collection('groupMembers'),
      requireUser, chatLive: createChatLiveHub(db),
    }))
    server = await new Promise((resolve) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
    })
    const response = await fetch(`http://127.0.0.1:${server.address().port}/companions/message-sounds/live`)
    assert.equal(response.status, 200)
    reader = response.body.getReader()
    assert.match(new TextDecoder().decode((await reader.read()).value), /retry:/)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const pending = reader.read()
    let received = false
    void pending.then(() => { received = true })
    await db.collection('groupMessages').insertOne({ groupId: groupId.toString(), senderId: me.toString(), createdAt: new Date() })
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(received, false)
    await db.collection('groupMessages').insertOne({ groupId: groupId.toString(), senderId: sender.toString(), createdAt: new Date() })
    assert.match(new TextDecoder().decode((await pending).value), /event: message/)
    await db.collection('companionMessages').insertOne({ conversationId: conversationId.toString(), senderId: sender.toString(), createdAt: new Date() })
    assert.match(new TextDecoder().decode((await reader.read()).value), /event: message/)
    session = null
    await db.collection('companionMessages').insertOne({ conversationId: conversationId.toString(), senderId: sender.toString(), createdAt: new Date() })
    assert.equal((await reader.read()).done, true)
  } finally {
    if (reader) await reader.cancel().catch(() => {})
    if (server) await new Promise((resolve) => server.close(resolve))
    await db.dropDatabase()
    await client.close()
  }
})
