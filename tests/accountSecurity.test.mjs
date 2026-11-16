import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountSecurity } from '../server/accountSecurity.js'

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

function fixture() {
  const user = { _id: 'user-one', email: 'learner@example.test', username: 'learner', avatarSeed: 'pixel-lime' }
  let now = new Date('2026-01-01T00:00:00.000Z')
  let deliveries = []
  let failing = false
  const users = {
    async updateOne(query, update) {
      if (!matches(user, query)) return { modifiedCount: 0 }
      for (const [path, value] of Object.entries(update.$set ?? {})) set(user, path, value)
      for (const [path, value] of Object.entries(update.$inc ?? {})) set(user, path, (get(user, path) ?? 0) + value)
      for (const [path, value] of Object.entries(update.$push ?? {})) {
        set(user, path, [...value.$each, ...(get(user, path) ?? [])].slice(0, value.$slice))
      }
      for (const path of Object.keys(update.$unset ?? {})) unset(user, path)
      return { modifiedCount: 1 }
    },
  }
  const security = createAccountSecurity({
    users,
    secret: 'a-test-secret-long-enough-to-use-as-a-key',
    mailer: { configured: true, async sendCode(message) { if (failing) throw new Error('delivery failure'); deliveries.push(message) } },
    renderAvatar: async () => Buffer.from('avatar'),
    clock: () => now,
  })
  return {
    security,
    read: () => structuredClone(user),
    deliveries: () => deliveries,
    advance: (milliseconds) => { now = new Date(now.getTime() + milliseconds) },
    fail: () => { failing = true },
  }
}

test('verification codes are private, single-use, and resend is rate-limited per account', async () => {
  const f = fixture()
  await f.security.sendCode(f.read(), 'verify')
  const code = f.deliveries()[0].code
  assert.notEqual(f.read().otp.verify.digest, code)
  await f.security.sendCode(f.read(), 'verify')
  assert.equal(f.deliveries().length, 1)
  const stale = f.read()
  const results = await Promise.all([
    f.security.consumeCode(stale, 'verify', code, { set: { emailVerifiedAt: new Date() } }),
    f.security.consumeCode(stale, 'verify', code, { set: { emailVerifiedAt: new Date() } }),
  ])
  assert.deepEqual(results.sort(), [false, true])
  assert.ok(f.read().emailVerifiedAt)
  assert.equal(f.read().otp.verify, undefined)
})

test('incorrect codes exhaust attempts and a later resend replaces the old code', async () => {
  const f = fixture()
  await f.security.sendCode(f.read(), 'reset')
  const original = f.deliveries()[0].code
  const wrong = original === '000000' ? '000001' : '000000'
  for (let i = 0; i < 5; i++) {
    assert.equal(await f.security.consumeCode(f.read(), 'reset', wrong, { set: {} }), false)
  }
  assert.equal(await f.security.consumeCode(f.read(), 'reset', original, { set: {} }), false)
  f.advance(60000)
  await f.security.sendCode(f.read(), 'reset')
  const replacement = f.deliveries()[1].code
  assert.equal(await f.security.consumeCode(f.read(), 'reset', replacement, {
    set: { passwordHash: 'new-hash' }, inc: { sessionVersion: 1 },
  }), true)
  assert.equal(f.read().passwordHash, 'new-hash')
  assert.equal(f.read().sessionVersion, 1)
})

test('delivery failures remove the unusable challenge and surface the error', async () => {
  const f = fixture()
  f.fail()
  await assert.rejects(() => f.security.sendCode(f.read(), 'verify'), /delivery failure/)
  assert.equal(f.read().otp.verify, undefined)
})

test('resending cannot bypass the hourly per-account limit', async () => {
  const f = fixture()
  for (let i = 0; i < 3; i++) {
    await f.security.sendCode(f.read(), 'reset')
    f.advance(60000)
  }
  await f.security.sendCode(f.read(), 'reset')
  assert.equal(f.deliveries().length, 3)
  f.advance(57 * 60000)
  await f.security.sendCode(f.read(), 'reset')
  assert.equal(f.deliveries().length, 4)
})
