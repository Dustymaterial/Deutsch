import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { MongoClient, ObjectId } from 'mongodb'
import { createHmac } from 'node:crypto'
import { createChatReplay } from '../server/chatReplay.js'
import { createCompanionRouter } from '../server/companions.js'
import { createGroupsRouter } from '../server/groups.js'

const uri = process.env.CHAT_LIVE_MONGO_URI

test('durable replay reconciles changes across instances and resets unsafe cursors', { skip: !uri, timeout: 30000 }, async () => {
  const clients = [new MongoClient(uri), new MongoClient(uri)]
  await Promise.all(clients.map((client) => client.connect()))
  const databases = clients.map((client) => client.db(`deutsch_replay_test_${process.pid}`))
  const db = databases[0]
  const [me, them] = [new ObjectId(), new ObjectId()]
  const participants = [me.toString(), them.toString()].sort()
  const groupId = new ObjectId()
  const conversationId = new ObjectId()
  const privateMessageId = new ObjectId()
  const groupMessageId = new ObjectId()
  const connectionId = new ObjectId().toString()
  const now = new Date()
  const servers = []
  try {
    await db.collection('users').insertMany([me, them].map((_id, index) => ({
      _id, username: `learner${index}`, avatarSeed: 'seed', emailVerifiedAt: now, groupRulesAcceptedAt: now,
    })))
    await db.collection('relationships').insertOne({ pairKey: participants.join(':'), participants, state: 'connected', blockedBy: [], connectionId })
    await db.collection('companionConversations').insertOne({ _id: conversationId, participants, connectionId })
    await db.collection('companionMessages').insertOne({ _id: privateMessageId, conversationId: conversationId.toString(), senderId: them.toString(), text: 'old', createdAt: now })
    await db.collection('groups').insertOne({ _id: groupId, name: 'Group', ownerId: me.toString(), state: 'open', memberCount: 1, createdAt: now })
    await db.collection('groupMembers').insertOne({ groupId: groupId.toString(), userId: me.toString(), state: 'active', joinedAt: now })
    await db.collection('groupMessages').insertOne({ _id: groupMessageId, groupId: groupId.toString(), senderId: them.toString(), text: 'old group', createdAt: now })
    for (const database of databases) {
      const app = express()
      const users = database.collection('users')
      const requireUser = (req, _res, next) => { req.accountUser = { _id: me, emailVerifiedAt: now }; next() }
      const chatReplay = createChatReplay(database, 'replica-test-secret')
      app.use('/companions', createCompanionRouter({
        users, relationships: database.collection('relationships'), sharedWords: database.collection('sharedWords'),
        conversations: database.collection('companionConversations'), companionMessages: database.collection('companionMessages'),
        companionReports: database.collection('companionReports'), chatTyping: database.collection('chatTyping'),
        requireUser, chatReplay,
      }))
      app.use('/groups', createGroupsRouter({
        users, groups: database.collection('groups'), groupMembers: database.collection('groupMembers'),
        groupMessages: database.collection('groupMessages'), groupReports: database.collection('groupReports'),
        chatTyping: database.collection('chatTyping'), isModerator: () => false, requireUser, chatReplay,
      }))
      servers.push(await new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server))
      }))
    }
    const get = async (server, path) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`)
      return { status: response.status, body: await response.json() }
    }
    const privatePath = `/companions/chats/${conversationId}`
    const groupPath = `/groups/${groupId}`
    const privateSnapshot = (await get(servers[0], `${privatePath}/messages?read=0`)).body
    const groupSnapshot = (await get(servers[0], `${groupPath}/messages?read=0`)).body
    assert.equal(typeof privateSnapshot.cursor, 'string')
    assert.equal(typeof groupSnapshot.cursor, 'string')
    await db.collection('companionMessages').updateOne({ _id: privateMessageId }, { $set: { text: 'edited', reactions: { [me.toString()]: '❤️' } } })
    const newMessage = new ObjectId()
    await db.collection('companionMessages').insertOne({ _id: newMessage, conversationId: conversationId.toString(), senderId: them.toString(), text: 'new', createdAt: new Date() })
    await db.collection('groupMessages').updateOne({ _id: groupMessageId }, { $set: { hiddenAt: new Date() } })
    const sync = (path, cursor) => `${path}/sync?cursor=${encodeURIComponent(cursor)}`
    const privateDelta = (await get(servers[1], sync(privatePath, privateSnapshot.cursor))).body
    assert.equal(privateDelta.reset, false)
    assert.equal(privateDelta.messages.find((message) => message.id === privateMessageId.toString()).text, 'edited')
    assert.equal(privateDelta.messages.find((message) => message.id === newMessage.toString()).text, 'new')
    const groupDelta = (await get(servers[1], sync(groupPath, groupSnapshot.cursor))).body
    assert.equal(groupDelta.reset, false)
    assert.equal(groupDelta.messages[0].kind, 'hidden')
    assert.equal((await get(servers[1], sync(groupPath, privateDelta.cursor))).body.reset, true)
    assert.equal((await get(servers[1], sync(privatePath, `${privateDelta.cursor}x`))).body.reset, true)
    const [payload] = privateDelta.cursor.split('.')
    const expiredData = JSON.parse(Buffer.from(payload, 'base64url').toString())
    expiredData.issuedAt -= 25 * 60 * 60 * 1000
    const expiredPayload = Buffer.from(JSON.stringify(expiredData)).toString('base64url')
    const signature = createHmac('sha256', 'replica-test-secret').update(expiredPayload).digest('base64url')
    assert.equal((await get(servers[1], sync(privatePath, `${expiredPayload}.${signature}`))).body.reset, true)

    await db.collection('companionMessages').deleteOne({ _id: privateMessageId })
    assert.equal((await get(servers[1], sync(privatePath, privateDelta.cursor))).body.reset, true)
    const afterDelete = (await get(servers[0], `${privatePath}/messages?read=0`)).body
    await db.collection('companionConversations').updateOne({ _id: conversationId }, { $set: { [`hiddenAt.${me}`]: new Date() } })
    assert.equal((await get(servers[1], sync(privatePath, afterDelete.cursor))).body.reset, true)
    await db.collection('groupMessages').deleteOne({ _id: groupMessageId })
    assert.equal((await get(servers[1], sync(groupPath, groupDelta.cursor))).body.reset, true)
    const afterGroupDelete = (await get(servers[0], `${groupPath}/messages?read=0`)).body
    await db.collection('groups').updateOne({ _id: groupId }, { $set: { name: 'Renamed' } })
    assert.equal((await get(servers[1], sync(groupPath, afterGroupDelete.cursor))).body.reset, true)
    await db.collection('groupMembers').updateOne({ groupId: groupId.toString(), userId: me.toString() }, { $set: { state: 'removed' } })
    assert.equal((await get(servers[1], sync(groupPath, groupDelta.cursor))).status, 404)
    await db.collection('relationships').updateOne({ pairKey: participants.join(':') }, { $set: { state: 'none' } })
    assert.equal((await get(servers[1], sync(privatePath, privateDelta.cursor))).status, 404)
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
    await db.dropDatabase()
    await Promise.all(clients.map((client) => client.close()))
  }
})

test('a replay backlog beyond its bound requests a snapshot reset', { skip: !uri, timeout: 30000 }, async () => {
  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(`deutsch_replay_limit_${process.pid}`)
  const scope = { kind: 'private', chatId: new ObjectId().toString(), userId: new ObjectId().toString() }
  try {
    const replay = createChatReplay(db, 'replica-test-secret')
    const cursor = await replay.snapshotCursor(scope)
    await db.collection('companionMessages').insertMany(Array.from({ length: 501 }, () => ({ conversationId: scope.chatId })))
    assert.deepEqual(await replay.replay(scope, cursor), { reset: true })
  } finally {
    await db.dropDatabase()
    await client.close()
  }
})
