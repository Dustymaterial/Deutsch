import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'

export function sendIdentity(data, chatId, userId) {
  if (!data.clientId) return null
  const hash = createHash('sha256').update(JSON.stringify([
    chatId, userId, data.text ?? null, data.card ?? null, data.replyToId ?? null,
    ...(data.wordPractice ? ['word-practice'] : []),
  ])).digest('hex')
  return { id: new ObjectId(data.clientId), hash }
}

export async function findSentMessage(collection, identity) {
  if (!identity) return null
  const message = await collection.findOne({ _id: identity.id })
  if (!message) return null
  if (message.clientRequestHash !== identity.hash) return false
  return message
}

export async function insertChatMessage(collection, message, identity) {
  try {
    const result = await collection.insertOne(identity
      ? { ...message, _id: identity.id, clientRequestHash: identity.hash } : message)
    return { ...message, _id: result.insertedId }
  } catch (error) {
    if (error?.code !== 11000 || !identity) throw error
    const existing = await findSentMessage(collection, identity)
    if (existing === null) throw error
    return existing
  }
}
