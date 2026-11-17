import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'

export const typingSchema = z.object({ typing: z.boolean() })
export const typingRateLimit = () => rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.accountUser._id.toString(),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many typing updates. Please try again later.' },
})

export async function setTyping(collection, kind, chatId, userId, typing) {
  const key = { kind, chatId, userId }
  if (typing) {
    await collection.updateOne(key, { $set: { expiresAt: new Date(Date.now() + 8000) } }, { upsert: true })
  } else {
    await collection.deleteOne(key)
  }
}

export function typingFilter(kind, chatId, userId) {
  return { kind, chatId, userId: { $ne: userId }, expiresAt: { $gt: new Date() } }
}
