import test from 'node:test'
import assert from 'node:assert/strict'
import { replayUpdatesInRange } from '../src/chatReplay.ts'
import { createChatReplay } from '../server/chatReplay.js'

test('replay updates loaded messages without introducing disconnected older history', () => {
  const current = [{ id: 'b', createdAt: '2026-01-01T00:00:00Z' }]
  const older = { id: 'a', createdAt: '2025-01-01T00:00:00Z' }
  const edited = { ...current[0], text: 'edited' }
  const later = { id: 'c', createdAt: '2026-01-01T00:00:00Z' }
  assert.deepEqual(replayUpdatesInRange(current, [older, edited, later]), [edited, later])
  assert.deepEqual(replayUpdatesInRange([], [older]), [older])
})

test('an expired oplog resume position explicitly resets rather than skipping changes', async () => {
  let closed = 0
  let fail = false
  const db = { watch: () => ({
    resumeToken: { _data: 'checkpoint' },
    async tryNext() {
      if (fail) throw Object.assign(new Error('history lost'), { code: 286 })
      return null
    },
    async close() { closed += 1 },
  }) }
  const replay = createChatReplay(db, 'test-secret')
  const scope = { kind: 'private', chatId: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }
  const cursor = await replay.snapshotCursor(scope)
  fail = true
  assert.deepEqual(await replay.replay(scope, cursor), { reset: true })
  assert.equal(closed, 2)
})

test('snapshot and replay explicitly use the primary for checkpoints', async () => {
  const options = []
  const db = { watch: (_pipeline, settings) => {
    options.push(settings)
    return {
      resumeToken: { _data: 'checkpoint' },
      async tryNext() { return null },
      async close() {},
    }
  } }
  const replay = createChatReplay(db, 'test-secret')
  const scope = { kind: 'private', chatId: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }
  const cursor = await replay.snapshotCursor(scope)
  await replay.replay(scope, cursor)
  assert.deepEqual(options.map((settings) => settings.readPreference), ['primary', 'primary'])
  assert.deepEqual(options[1].resumeAfter, { _data: 'checkpoint' })
})

test('database failures are surfaced instead of advancing the replay cursor', async () => {
  let calls = 0
  const db = { watch: () => ({
    resumeToken: { _data: 'checkpoint' },
    async tryNext() {
      if (++calls > 1) throw new Error('database unavailable')
      return null
    },
    async close() {},
  }) }
  const replay = createChatReplay(db, 'test-secret')
  const scope = { kind: 'private', chatId: 'aaaaaaaaaaaaaaaaaaaaaaaa', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }
  const cursor = await replay.snapshotCursor(scope)
  await assert.rejects(replay.replay(scope, cursor), /database unavailable/)
})
