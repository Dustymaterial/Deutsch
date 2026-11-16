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
      throw new Error(`Unknown operator ${operator}`)
    })
  }
  return actual === expected
})
const records = { users: [], progress: [] }
const collection = (name) => ({
  async createIndex() {},
  async findOne(query) {
    const record = records[name].find((item) => matches(item, query))
    return record ? { ...record, otp: record.otp ? structuredClone(record.otp) : undefined } : null
  },
  async insertOne(value) {
    if (records[name].some((item) => item.emailKey === value.emailKey || item.usernameKey === value.usernameKey)) {
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
const nativeFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (url === 'https://api.mailjet.com/v3.1/send') {
    const message = JSON.parse(options.body).Messages[0]
    assert.equal(message.InlinedAttachments[0].ContentType, 'image/png')
    assert.equal(message.InlinedAttachments[0].ContentID, 'avatar')
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
  const legacy = { _id: new ObjectId(), email: 'legacy@example.test', emailKey: 'legacy@example.test', username: 'legacy', avatarSeed: 'pixel-red', passwordHash: await bcrypt.hash(password, 4) }
  records.users.push(legacy)
  const legacyLogin = await request('/api/auth/login', { email: legacy.email, password })
  assert.equal(legacyLogin.status, 200)
  assert.equal(legacyLogin.body.user.emailVerified, false)
  console.log('Account API integration passed')
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  mock.reset()
}
