import test from 'node:test'
import assert from 'node:assert/strict'
import { messageDelta } from '../server/chatDelta.js'

test('live history sends only new or changed messages and suppresses identical updates', () => {
  const state = { messages: new Map() }
  const messages = Array.from({ length: 50 }, (_, i) => ({ id: String(i), text: 'Example message '.repeat(15) }))
  const page = { hasMore: true, messages }
  assert.equal(messageDelta(state, page).messages.length, 50)
  assert.equal(messageDelta(state, page), null)
  const next = { ...page, messages: [...messages.slice(1), { id: 'new', text: 'New message' }] }
  const delta = messageDelta(state, next)
  assert.deepEqual(delta.messages, [{ id: 'new', text: 'New message' }])
  assert.ok(Buffer.byteLength(JSON.stringify(delta)) < Buffer.byteLength(JSON.stringify(next)) / 20)
  assert.equal(messageDelta(state, next), null)
  assert.deepEqual(messageDelta(state, { ...next, messages: [{ id: '2', text: 'Edited' }] }).messages, [{ id: '2', text: 'Edited' }])
})
