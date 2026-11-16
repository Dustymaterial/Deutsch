import { createAccountOtp, matchesAccountOtp, OTP_MAX_ATTEMPTS } from './accountOtp.js'

const RESEND_DELAY_MS = 60 * 1000
const SEND_WINDOW_MS = 60 * 60 * 1000

export function createAccountSecurity({ users, secret, mailer, renderAvatar, clock = () => new Date() }) {
  async function sendCode(user, purpose) {
    if (!mailer.configured) throw new Error('Account email is not configured.')
    const now = clock()
    const field = `otp.${purpose}`
    const throttle = `otpThrottle.${purpose}`
    const { code, challenge } = createAccountOtp(secret, user._id.toString(), purpose, now)
    challenge.sentAt = now
    const updated = await users.updateOne({
      _id: user._id,
      $and: [
        { $or: [
          { [`${throttle}.lastSentAt`]: { $exists: false } },
          { [`${throttle}.lastSentAt`]: { $lte: new Date(now.getTime() - RESEND_DELAY_MS) } },
        ] },
        { $or: [
          { [`${throttle}.history.2`]: { $exists: false } },
          { [`${throttle}.history.2`]: { $lte: new Date(now.getTime() - SEND_WINDOW_MS) } },
        ] },
      ],
    }, {
      $set: { [field]: challenge, [`${throttle}.lastSentAt`]: now },
      $push: { [`${throttle}.history`]: { $each: [now], $position: 0, $slice: 3 } },
    })
    if (!updated.modifiedCount) return

    try {
      await mailer.sendCode({
        email: user.email,
        username: user.username,
        code,
        purpose,
        avatarPng: await renderAvatar(user.avatarSeed),
      })
    } catch (error) {
      await users.updateOne({ _id: user._id, [`${field}.digest`]: challenge.digest }, { $unset: { [field]: '' } })
      throw error
    }
  }

  async function consumeCode(user, purpose, code, changes) {
    const field = `otp.${purpose}`
    const challenge = user.otp?.[purpose]
    const now = clock()
    if (!challenge || !matchesAccountOtp(secret, user._id.toString(), purpose, code, challenge, now)) {
      if (challenge?.digest) {
        await users.updateOne({
          _id: user._id,
          [`${field}.digest`]: challenge.digest,
          [`${field}.expiresAt`]: { $gt: now },
          [`${field}.attempts`]: { $lt: OTP_MAX_ATTEMPTS },
        }, { $inc: { [`${field}.attempts`]: 1 } })
      }
      return false
    }
    const result = await users.updateOne({
      _id: user._id,
      [`${field}.digest`]: challenge.digest,
      [`${field}.expiresAt`]: { $gt: now },
      [`${field}.attempts`]: { $lt: OTP_MAX_ATTEMPTS },
    }, {
      $set: { ...changes.set, updatedAt: now },
      ...(changes.inc ? { $inc: changes.inc } : {}),
      $unset: { [field]: '' },
    })
    return result.modifiedCount === 1
  }

  return { sendCode, consumeCode }
}
