import { rateLimit } from 'express-rate-limit'
import { ObjectId } from 'mongodb'

export const receiptStatus = (message) => message.readReceiptAt ? 'read' : message.deliveredAt ? 'delivered' : 'sent'

export function receiptRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000, limit: 120,
    keyGenerator: (req) => req.accountUser._id.toString(),
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many receipt updates. Please try again later.' },
  })
}

export async function acknowledgeMessages(collection, scope, userId, through, ids, seen, hiddenAt) {
  const now = new Date()
  await collection.updateMany({
    ...scope,
    senderId: { $ne: userId },
    _id: { $in: ids.map((id) => new ObjectId(id)) },
    ...(hiddenAt ? { createdAt: { $gt: hiddenAt } } : {}),
    $or: [
      { createdAt: { $lt: through.createdAt } },
      { createdAt: through.createdAt, _id: { $lte: through._id } },
    ],
    [seen ? 'readReceiptAt' : 'deliveredAt']: { $exists: false },
  }, { $set: seen ? { readReceiptAt: now, deliveredAt: now } : { deliveredAt: now } })
}
