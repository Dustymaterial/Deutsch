import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mock } from 'node:test'
import session from 'express-session'
import { ObjectId } from 'mongodb'
import bcrypt from 'bcryptjs'

const get = (object, path) => path.split('.').reduce((value, part) => value?.[part], object)
const set = (object, path, value) => {
  const parts = path.split('.')
  const last = parts.pop()
  const parent = parts.reduce((value, part) => value[part] ??= {}, object)
  parent[last] = value
}
const unset = (object, path) => {
  const parts = path.split('.')
  const last = parts.pop()
  const parent = parts.reduce((value, part) => value?.[part], object)
  if (parent) delete parent[last]
}
const matches = (object, query) => Object.entries(query).every(([key, expected]) => {
  if (key === '$or') return expected.some((part) => matches(object, part))
  if (key === '$and') return expected.every((part) => matches(object, part))
  const actual = get(object, key)
  if (expected instanceof ObjectId) return actual?.toString() === expected.toString()
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === '$exists') return (actual !== undefined) === value
      if (operator === '$lte') return actual !== undefined && actual <= value
      if (operator === '$lt') return actual !== undefined && actual < value
      if (operator === '$gt') return actual !== undefined && actual > value
      if (operator === '$ne') return actual !== value
      throw new Error(`Unknown operator ${operator}`)
    })
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected
})
const records = {
  users: [], progress: [], relationships: [], sharedWords: [],
  companionConversations: [], companionMessages: [], companionReports: [],
}
const collection = (name) => ({
  async createIndex() {},
  find(query, options = {}) {
    let result = records[name].filter((item) => matches(item, query)).map((item) => ({ ...item }))
    if (options.sort) {
      const entries = Object.entries(options.sort)
      result.sort((left, right) => {
        for (const [field, direction] of entries) {
          const difference = get(left, field) - get(right, field)
          if (difference) return direction * difference
        }
        return 0
      })
    }
    if (options.limit) result = result.slice(0, options.limit)
    return { async toArray() { return result } }
  },
  async findOne(query, options = {}) {
    let matchesQuery = records[name].filter((item) => matches(item, query))
    if (options.sort) {
      const [[field, direction]] = Object.entries(options.sort)
      matchesQuery = matchesQuery.sort((left, right) => direction * (get(left, field) - get(right, field)))
    }
    const record = matchesQuery[0]
    return record ? { ...record, otp: record.otp ? structuredClone(record.otp) : undefined } : null
  },
  async insertOne(value) {
    if (records[name].some((item) => (value.emailKey && item.emailKey === value.emailKey)
      || (value.usernameKey && item.usernameKey === value.usernameKey)
      || (value.pairKey && item.pairKey === value.pairKey
        && (name !== 'companionConversations' || item.connectionId === value.connectionId))
      || (value.reporterId && item.reporterId === value.reporterId && item.messageId === value.messageId))) {
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    }
    const _id = new ObjectId()
    records[name].push({ ...value, _id })
    return { insertedId: _id }
  },
  async updateOne(query, update) {
    const record = records[name].find((item) => matches(item, query))
    if (!record) return { matchedCount: 0, modifiedCount: 0 }
    for (const [path, value] of Object.entries(update.$set ?? {})) set(record, path, value)
    for (const [path, value] of Object.entries(update.$inc ?? {})) set(record, path, (get(record, path) ?? 0) + value)
    for (const [path, value] of Object.entries(update.$addToSet ?? {})) {
      const current = get(record, path) ?? []
      if (!current.includes(value)) set(record, path, [...current, value])
    }
    for (const [path, value] of Object.entries(update.$push ?? {})) {
      set(record, path, [...value.$each, ...(get(record, path) ?? [])].slice(0, value.$slice))
    }
    for (const path of Object.keys(update.$unset ?? {})) unset(record, path)
    return { matchedCount: 1, modifiedCount: 1 }
  },
})
class FakeMongoClient {
  async connect() {}
  db() { return { collection } }
}
mock.module('mongodb', { namedExports: { MongoClient: FakeMongoClient, ObjectId } })
mock.module('connect-mongo', { defaultExport: { create: () => new session.MemoryStore() } })
mock.module('dotenv', { defaultExport: { config: () => ({ parsed: {} }) } })

process.env.MONGODB_URI = 'mongodb://test:test@localhost:27017/deutsch'
process.env.SESSION_SECRET = 'test-secret-with-at-least-thirty-two-characters'
process.env.MAILJET_API_KEY = 'test-key'
process.env.MAILJET_SECRET_KEY = 'test-secret'
process.env.SENDER_EMAIL = 'sender@example.test'
process.env.PORT = '0'
const deliveries = []
let failCompanionDelivery = false
const nativeFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (url === 'https://api.mailjet.com/v3.1/send') {
    const message = JSON.parse(options.body).Messages[0]
    assert.equal(message.InlinedAttachments[0].ContentType, 'image/png')
    assert.equal(message.InlinedAttachments[0].ContentID, 'avatar')
    if (failCompanionDelivery && message.Subject.includes('companion request')) {
      return new Response('', { status: 500 })
    }
    deliveries.push(message)
    return new Response(JSON.stringify({ Messages: [{ Status: 'success' }] }), { status: 200 })
  }
  return nativeFetch(url, options)
}

const { server } = await import('../../server/index.js')
if (!server.listening) await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const request = async (path, body, cookie) => {
  const response = await nativeFetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }
}
const waitForDelivery = async (count) => {
  for (let i = 0; i < 100 && deliveries.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(deliveries.length, count)
  return deliveries.at(-1).TextPart.match(/\b\d{6}\b/)[0]
}

try {
  const email = 'learner@example.test'
  const password = 'correct-password-123'
  const invalidUsername = await request('/api/auth/register', { email, password, username: 'name@example.com', avatarSeed: 'pixel-lime' })
  assert.equal(invalidUsername.status, 400)
  assert.equal(invalidUsername.body.error, 'Username can use only letters, numbers, underscores, or hyphens; it cannot be an email address.')
  assert.equal(deliveries.length, 0)
  const registration = await request('/api/auth/register', { email, password, username: 'learner', avatarSeed: 'pixel-lime' })
  assert.equal(registration.status, 201)
  assert.equal(registration.body.verificationRequired, true)
  const code = await waitForDelivery(1)
  assert.equal((await request('/api/auth/login', { email, password })).status, 403)
  assert.equal((await request('/api/auth/verify', { email, code })).status, 200)
  assert.equal((await request('/api/auth/verify', { email, code })).status, 400)
  const login = await request('/api/auth/login', { email, password })
  assert.equal(login.status, 200)
  assert.equal(login.body.user.emailVerified, true)
  const secondLogin = await request('/api/auth/login', { email, password })
  assert.equal(secondLogin.status, 200)
  assert.equal((await request('/api/auth/change-password', { currentPassword: password, password: 'new-password-123' }, login.cookie)).status, 200)
  assert.equal((await request('/api/auth/me', null, login.cookie)).status, 200)
  assert.equal((await request('/api/auth/me', null, secondLogin.cookie)).status, 401)
  const absent = await request('/api/auth/code', { email: 'absent@example.test', purpose: 'reset' })
  const requested = await request('/api/auth/code', { email, purpose: 'reset' })
  assert.equal(absent.status, 202)
  assert.equal(requested.status, 202)
  assert.deepEqual(absent.body, requested.body)
  const resetCode = await waitForDelivery(2)
  assert.equal((await request('/api/auth/reset-password', { email, code: resetCode, password: 'reset-password-123' })).status, 200)
  assert.equal((await request('/api/auth/me', null, login.cookie)).status, 401)
  assert.equal((await request('/api/auth/login', { email, password: 'reset-password-123' })).status, 200)
  const legacy = { _id: new ObjectId(), email: 'legacy@example.test', emailKey: 'legacy@example.test', username: 'legacy', usernameKey: 'legacy', emailVerifiedAt: null, avatarSeed: 'pixel-red', passwordHash: await bcrypt.hash(password, 4) }
  records.users.push(legacy)
  const legacyLogin = await request('/api/auth/login', { email: legacy.email, password })
  assert.equal(legacyLogin.status, 200)
  assert.equal(legacyLogin.body.user.emailVerified, false)
  assert.equal((await request('/api/companions/', null, legacyLogin.cookie)).status, 403)

  const companion = {
    _id: new ObjectId(), email: 'companion@example.test', emailKey: 'companion@example.test',
    username: 'Companion', usernameKey: 'companion', avatarSeed: 'pixel-red',
    emailVerifiedAt: new Date(), passwordHash: await bcrypt.hash(password, 4),
  }
  records.users.push(companion)
  const learner = await request('/api/auth/login', { email, password: 'reset-password-123' })
  const other = await request('/api/auth/login', { email: companion.email, password })
  for (let index = 0; index < 301; index++) {
    assert.equal((await request('/api/companions/chats', null, learner.cookie)).status, 200)
  }
  const learnerId = records.users.find((item) => item.email === email)._id.toString()
  const otherId = companion._id.toString()
  assert.equal((await request('/api/companions/', null, null)).status, 401)
  assert.equal((await request('/api/companions/search', { username: 'legacy' }, learner.cookie)).status, 404)
  assert.equal((await request('/api/companions/request', { id: legacy._id.toString() }, learner.cookie)).status, 404)
  const found = await request('/api/companions/search', { username: 'COMPANION' }, learner.cookie)
  assert.deepEqual(found.body.user, { id: otherId, username: 'Companion', avatarSeed: 'pixel-red' })
  assert.equal((await request('/api/companions/search', { username: 'comp' }, learner.cookie)).status, 404)
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 201)
  assert.equal(deliveries.length, 3)
  assert.match(deliveries[2].TextPart, /learner would like/)
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 409)
  assert.equal((await request('/api/companions/action', { id: otherId, action: 'accept' }, learner.cookie)).status, 409)
  assert.equal((await request('/api/companions/chats/open', { id: otherId }, learner.cookie)).status, 404)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.companions[0].status, 'incoming')
  assert.equal((await request('/api/companions/action', { id: learnerId, action: 'accept' }, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/', null, learner.cookie)).body.companions[0].status, 'connected')
  const shared = await request('/api/companions/share', {
    recipientId: otherId,
    card: { prompt: 'der Sprachkurs', article: 'der', plural: 'Sprachkurse', meaning: 'language course', example: 'Der Sprachkurs beginnt heute.', translation: 'The language course begins today.', category: 'noun' },
    note: '<A useful word>',
  }, learner.cookie)
  assert.equal(shared.status, 201)
  assert.equal(deliveries.length, 4)
  assert.match(deliveries[3].Subject, /German word/)
  assert.doesNotMatch(deliveries[3].TextPart, /Sprachkurs|useful word/)
  const inbox = await request('/api/companions/', null, other.cookie)
  assert.equal(inbox.body.sharedWords.length, 1)
  assert.equal(inbox.body.sharedWords[0].sender.username, 'learner')
  assert.equal(inbox.body.sharedWords[0].note, '<A useful word>')
  assert.deepEqual(Object.keys(inbox.body.sharedWords[0].card).sort(), ['article', 'category', 'example', 'meaning', 'plural', 'prompt', 'translation'])
  assert.equal((await request(`/api/companions/shares/${shared.body.id}/add`, {}, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.sharedWords.length, 0)
  assert.equal((await request(`/api/companions/shares/${shared.body.id}/add`, {}, other.cookie)).status, 404)
  assert.equal((await request('/api/companions/share', {
    recipientId: otherId,
    card: { prompt: 'lernen', meaning: 'to learn', example: 'Wir lernen Deutsch.', category: 'verb' },
    note: 'x'.repeat(241),
  }, learner.cookie)).status, 400)
  assert.equal((await request('/api/companions/settings', { emailsEnabled: false }, other.cookie)).status, 200)
  const quietShare = await request('/api/companions/share', {
    recipientId: otherId,
    card: { prompt: 'lernen', meaning: 'to learn', example: 'Wir lernen Deutsch.', category: 'verb' },
  }, learner.cookie)
  assert.equal(quietShare.status, 201)
  assert.equal(deliveries.length, 4)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.sharedWords.length, 1)
  assert.equal((await request(`/api/companions/shares/${quietShare.body.id}/dismiss`, {}, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.sharedWords.length, 0)
  assert.equal((await request('/api/companions/settings', { emailsEnabled: true }, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/nudge', { id: otherId }, learner.cookie)).status, 201)
  assert.equal(deliveries.length, 5)
  assert.match(deliveries[4].TextPart, /cheering you on/)
  assert.equal((await request('/api/companions/nudge', { id: otherId }, learner.cookie)).status, 429)
  assert.ok((await request('/api/companions/', null, other.cookie)).body.companions[0].nudgeAt)
  assert.equal((await request('/api/companions/nudge/read', { id: learnerId }, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.companions[0].nudgeAt, undefined)
  const openedChat = await request('/api/companions/chats/open', { id: otherId }, learner.cookie)
  assert.equal(openedChat.status, 200)
  assert.equal((await request('/api/companions/chats/open', { id: learnerId }, other.cookie)).body.id, openedChat.body.id)
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: '   ' }, learner.cookie)).status, 400)
  const sentMessage = await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: '  Viel Erfolg beim Lernen!  ' }, learner.cookie)
  assert.equal(sentMessage.status, 201)
  assert.equal(sentMessage.body.message.text, 'Viel Erfolg beim Lernen!')
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: 'x'.repeat(2001) }, learner.cookie)).status, 400)
  records.users.find((item) => item.email === email).companionMessageHistory = Array.from({ length: 60 }, () => new Date())
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: 'Rate limit check.' }, learner.cookie)).status, 429)
  records.users.find((item) => item.email === email).companionMessageHistory = []
  const receivedMessages = await request(`/api/companions/chats/${openedChat.body.id}/messages`, null, other.cookie)
  assert.equal(receivedMessages.body.messages.length, 1)
  assert.equal(receivedMessages.body.messages[0].isMine, false)
  const unreadChat = (await request('/api/companions/chats', null, learner.cookie)).body.chats[0]
  assert.equal(unreadChat.lastMessage.text, 'Viel Erfolg beim Lernen!')
  assert.equal(unreadChat.unread, false)
  const report = await request(`/api/companions/messages/${sentMessage.body.message.id}/report`, {
    reason: 'other', details: 'This is a test report.',
  }, other.cookie)
  assert.equal(report.status, 201)
  assert.equal((await request(`/api/companions/messages/${sentMessage.body.message.id}/report`, { reason: 'spam' }, other.cookie)).status, 409)
  assert.equal((await request(`/api/companions/messages/${sentMessage.body.message.id}/report`, { reason: 'spam' }, learner.cookie)).status, 404)
  assert.equal(records.companionReports[0].reportedUserId, learnerId)
  const reply = await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: 'Danke!' }, other.cookie)
  assert.equal(reply.status, 201)
  assert.equal((await request('/api/companions/chats', null, learner.cookie)).body.chats[0].unread, true)
  const messagesPath = `/api/companions/chats/${openedChat.body.id}/messages`
  const wordCard = { prompt: 'die Lektion', article: 'die', meaning: 'lesson', example: 'Die Lektion ist kurz.', category: 'noun' }
  const wordMessage = await request(messagesPath, { card: wordCard }, learner.cookie)
  assert.equal(wordMessage.status, 201)
  assert.equal(wordMessage.body.message.kind, 'word')
  assert.equal(wordMessage.body.message.text, 'Shared a word: die Lektion')
  assert.deepEqual(wordMessage.body.message.card, wordCard)
  assert.equal((await request(messagesPath, { card: wordCard, text: 'Both' }, learner.cookie)).status, 400)
  assert.equal((await request(messagesPath, { card: { ...wordCard, article: undefined } }, learner.cookie)).status, 400)
  assert.equal((await request('/api/companions/chats', null, other.cookie)).body.chats[0].lastMessage.text, 'Shared a word: die Lektion')
  const threaded = await request(messagesPath, { text: 'Gern!', replyToId: reply.body.message.id }, learner.cookie)
  assert.equal(threaded.status, 201)
  assert.deepEqual(threaded.body.message.replyTo, { id: reply.body.message.id, isMine: false, text: 'Danke!' })
  assert.equal((await request(messagesPath, { text: 'Lost', replyToId: new ObjectId().toString() }, learner.cookie)).status, 400)
  const reactionPath = `/api/companions/messages/${threaded.body.message.id}/reaction`
  assert.equal((await request(reactionPath, { emoji: '😈' }, other.cookie)).status, 400)
  assert.deepEqual((await request(reactionPath, { emoji: '🎉' }, other.cookie)).body.reactions, [{ emoji: '🎉', count: 1, mine: true }])
  assert.deepEqual((await request(reactionPath, { emoji: '💡' }, other.cookie)).body.reactions, [{ emoji: '💡', count: 1, mine: true }])
  assert.deepEqual((await request(reactionPath, { emoji: '💡' }, learner.cookie)).body.reactions, [{ emoji: '💡', count: 2, mine: true }])
  const reacted = (await request(messagesPath, null, learner.cookie)).body.messages.find((item) => item.id === threaded.body.message.id)
  assert.deepEqual(reacted.reactions, [{ emoji: '💡', count: 2, mine: true }])
  assert.deepEqual((await request(reactionPath, { emoji: null }, other.cookie)).body.reactions, [{ emoji: '💡', count: 1, mine: false }])
  assert.equal((await request(`/api/companions/messages/${new ObjectId().toString()}/reaction`, { emoji: '👍' }, other.cookie)).status, 404)
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/delete`, {}, learner.cookie)).status, 200)
  assert.equal((await request('/api/companions/chats', null, learner.cookie)).body.chats.length, 0)
  assert.equal((await request('/api/companions/chats', null, other.cookie)).body.chats.length, 1)
  assert.deepEqual((await request(`/api/companions/chats/${openedChat.body.id}/messages`, null, learner.cookie)).body.messages, [])
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/messages`, { text: 'A new message after deletion.' }, other.cookie)).status, 201)
  const afterDeleteMessage = await request(`/api/companions/chats/${openedChat.body.id}/messages`, null, learner.cookie)
  assert.deepEqual(afterDeleteMessage.body.messages.map((item) => item.text), ['A new message after deletion.'])
  assert.equal((await request('/api/companions/action', { id: otherId, action: 'block' }, learner.cookie)).status, 200)
  assert.equal((await request(`/api/companions/chats/${openedChat.body.id}/messages`, null, other.cookie)).status, 404)
  assert.equal((await request('/api/companions/search', { username: 'learner' }, other.cookie)).status, 404)
  assert.deepEqual((await request('/api/companions/', null, other.cookie)).body.companions, [])
  assert.equal((await request('/api/companions/request', { id: learnerId }, other.cookie)).status, 404)
  assert.equal((await request('/api/companions/', null, learner.cookie)).body.companions[0].status, 'blocked')
  assert.equal((await request('/api/companions/action', { id: otherId, action: 'unblock' }, learner.cookie)).status, 200)
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 429)
  records.relationships[0].closedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
  assert.equal((await request('/api/companions/settings', { emailsEnabled: false }, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.emailsEnabled, false)
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 201)
  assert.equal(deliveries.length, 5)
  assert.equal((await request('/api/companions/action', { id: learnerId, action: 'decline' }, other.cookie)).status, 200)
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 429)
  assert.deepEqual((await request('/api/companions/', null, learner.cookie)).body.companions, [])
  records.relationships[0].closedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const concurrent = await Promise.all([
    request('/api/companions/request', { id: otherId }, learner.cookie),
    request('/api/companions/request', { id: otherId }, learner.cookie),
  ])
  assert.deepEqual(concurrent.map((item) => item.status).sort(), [201, 409])
  assert.equal((await request('/api/companions/action', { id: otherId, action: 'cancel' }, learner.cookie)).status, 200)
  records.relationships[0].closedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
  assert.equal((await request('/api/companions/settings', { emailsEnabled: true }, other.cookie)).status, 200)
  companion.companionEmailHistory = Array.from({ length: 5 }, () => new Date())
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 201)
  assert.equal(deliveries.length, 5)
  assert.equal((await request('/api/companions/action', { id: otherId, action: 'cancel' }, learner.cookie)).status, 200)
  records.relationships[0].closedAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
  records.users.find((item) => item.email === email).companionRequestHistory = Array.from({ length: 10 }, () => new Date())
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 429)
  records.users.find((item) => item.email === email).companionRequestHistory = []
  companion.companionEmailHistory = []
  failCompanionDelivery = true
  assert.equal((await request('/api/companions/request', { id: otherId }, learner.cookie)).status, 201)
  assert.equal((await request('/api/companions/', null, other.cookie)).body.companions[0].status, 'incoming')
  assert.equal(deliveries.length, 5)
  console.log('Account API integration passed')
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  mock.reset()
}
