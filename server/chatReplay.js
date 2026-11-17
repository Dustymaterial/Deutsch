import { createHmac, timingSafeEqual } from 'node:crypto'
import { ObjectId } from 'mongodb'

const maxAge = 24 * 60 * 60 * 1000
const maxChanges = 500
const expiredCodes = new Set([136, 237, 260, 280, 286, 40573])

export function createChatReplay(db, secret) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url')
  const encode = (scope, token) => {
    const payload = Buffer.from(JSON.stringify({ ...scope, token, issuedAt: Date.now() })).toString('base64url')
    return `${payload}.${sign(payload)}`
  }
  const decode = (scope, cursor) => {
    if (typeof cursor !== 'string' || cursor.length > 2048) return null
    const parts = cursor.split('.')
    if (parts.length !== 2) return null
    const signature = Buffer.from(parts[1], 'base64url')
    const expected = Buffer.from(sign(parts[0]), 'base64url')
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null
    let data
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) } catch { return null }
    if (data.kind !== scope.kind || data.chatId !== scope.chatId || data.userId !== scope.userId
      || !Number.isSafeInteger(data.issuedAt) || data.issuedAt > Date.now() || Date.now() - data.issuedAt >= maxAge
      || typeof data.token?._data !== 'string') return null
    return data.token
  }
  const pipeline = (scope) => {
    const messages = scope.kind === 'private' ? 'companionMessages' : 'groupMessages'
    const field = scope.kind === 'private' ? 'conversationId' : 'groupId'
    const conditions = [
      { 'ns.coll': messages, [`fullDocument.${field}`]: scope.chatId },
      { 'ns.coll': messages, operationType: 'delete' },
      { 'ns.coll': messages, operationType: { $in: ['drop', 'rename', 'invalidate'] } },
    ]
    if (scope.kind === 'private') {
      conditions.push({ 'ns.coll': 'companionConversations', 'documentKey._id': new ObjectId(scope.chatId) })
    } else {
      conditions.push({ 'ns.coll': 'groups', 'documentKey._id': new ObjectId(scope.chatId) })
    }
    return [{ $match: { $or: conditions } }]
  }

  async function snapshotCursor(scope) {
    const stream = db.watch(pipeline(scope), { fullDocument: 'updateLookup', maxAwaitTimeMS: 10, readPreference: 'primary' })
    try {
      await stream.tryNext()
      if (!stream.resumeToken) throw new Error('MongoDB did not provide a chat replay checkpoint.')
      return encode(scope, stream.resumeToken)
    } finally {
      await stream.close()
    }
  }

  async function replay(scope, cursor) {
    const token = decode(scope, cursor)
    if (!token) return { reset: true }
    const stream = db.watch(pipeline(scope), { resumeAfter: token, fullDocument: 'updateLookup', maxAwaitTimeMS: 10, readPreference: 'primary' })
    const ids = new Set()
    try {
      for (let count = 0; count <= maxChanges; count += 1) {
        const change = await stream.tryNext()
        if (!change) {
          if (!stream.resumeToken) throw new Error('MongoDB did not provide a chat replay checkpoint.')
          return { reset: false, ids: [...ids], cursor: encode(scope, stream.resumeToken) }
        }
        if (count === maxChanges || change.operationType === 'delete'
          || ['drop', 'rename', 'invalidate'].includes(change.operationType)) return { reset: true }
        const collection = change.ns?.coll
        if (collection === 'companionMessages' || collection === 'groupMessages') {
          if (!change.documentKey?._id) return { reset: true }
          ids.add(change.documentKey._id.toString())
        } else if (collection === 'companionConversations') {
          const fields = Object.keys(change.updateDescription?.updatedFields ?? {})
          const removed = change.updateDescription?.removedFields ?? []
          if (change.operationType !== 'update' || [...fields, ...removed].some((field) => field === 'hiddenAt' || field.startsWith('hiddenAt.'))) {
            return { reset: true }
          }
        } else if (collection === 'groups') {
          const fields = Object.keys(change.updateDescription?.updatedFields ?? {})
          const removed = change.updateDescription?.removedFields ?? []
          if (change.operationType !== 'update' || [...fields, ...removed].some((field) => field !== 'lastActivityAt')) {
            return { reset: true }
          }
        }
      }
      return { reset: true }
    } catch (error) {
      if (expiredCodes.has(error?.code)) return { reset: true }
      throw error
    } finally {
      await stream.close()
    }
  }

  return { snapshotCursor, replay }
}
