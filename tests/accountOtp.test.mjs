import test from 'node:test'
import assert from 'node:assert/strict'
import { createAccountOtp, matchesAccountOtp, OTP_LIFETIME_MS, OTP_MAX_ATTEMPTS } from '../server/accountOtp.js'

const secret = 'a-test-secret-long-enough-to-use-as-a-key'
const now = new Date('2026-01-01T00:00:00.000Z')

test('a code is bound to the account and purpose without storing it', () => {
  const { code, challenge } = createAccountOtp(secret, 'user-one', 'verify', now)
  assert.match(code, /^\d{6}$/)
  assert.notEqual(challenge.digest, code)
  assert.equal(matchesAccountOtp(secret, 'user-one', 'verify', code, challenge, now), true)
  assert.equal(matchesAccountOtp(secret, 'user-two', 'verify', code, challenge, now), false)
  assert.equal(matchesAccountOtp(secret, 'user-one', 'reset', code, challenge, now), false)
  assert.equal(matchesAccountOtp(secret, 'user-one', 'verify', 'not-a-code', challenge, now), false)
})

test('expired, exhausted and malformed challenges are rejected', () => {
  const { code, challenge } = createAccountOtp(secret, 'user-one', 'reset', now)
  const match = (candidate, at = now) => matchesAccountOtp(secret, 'user-one', 'reset', code, candidate, at)
  assert.equal(match(challenge, new Date(now.getTime() + OTP_LIFETIME_MS - 1)), true)
  assert.equal(match(challenge, new Date(now.getTime() + OTP_LIFETIME_MS)), false)
  assert.equal(match({ ...challenge, attempts: OTP_MAX_ATTEMPTS }), false)
  assert.equal(match({ ...challenge, digest: 'broken' }), false)
  assert.equal(match({ ...challenge, expiresAt: new Date('invalid') }), false)
})
