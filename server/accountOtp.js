import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const OTP_LIFETIME_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5

const digest = (secret, userId, purpose, code) =>
  createHmac('sha256', secret)
    .update(JSON.stringify([userId, purpose, code]))
    .digest('hex')

export function createAccountOtp(secret, userId, purpose, now = new Date()) {
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  return {
    code,
    challenge: {
      digest: digest(secret, userId, purpose, code),
      expiresAt: new Date(now.getTime() + OTP_LIFETIME_MS),
      attempts: 0,
    },
  }
}

export function matchesAccountOtp(secret, userId, purpose, code, challenge, now = new Date()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !challenge || !Number.isInteger(challenge.attempts) ||
      challenge.attempts < 0 || challenge.attempts >= OTP_MAX_ATTEMPTS ||
      !(challenge.expiresAt instanceof Date) || !Number.isFinite(challenge.expiresAt.getTime()) ||
      challenge.expiresAt.getTime() <= now.getTime() ||
      typeof challenge.digest !== 'string' || !/^[a-f0-9]{64}$/.test(challenge.digest)) return false
  const expected = Buffer.from(challenge.digest, 'hex')
  const actual = Buffer.from(digest(secret, userId, purpose, code), 'hex')
  return timingSafeEqual(expected, actual)
}
