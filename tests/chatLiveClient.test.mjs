import test from 'node:test'
import assert from 'node:assert/strict'
import { watchChatChanges } from '../src/chatLive.ts'

test('live refreshes coalesce while a request is running and stop on close', async () => {
  const original = globalThis.EventSource
  let source
  globalThis.EventSource = class {
    handlers = new Map()
    constructor() { source = this }
    addEventListener(name, callback) { this.handlers.set(name, callback) }
    close() { this.closed = true }
    emit(name) { this.handlers.get(name)() }
  }
  try {
    let runs = 0
    let finish
    const stop = watchChatChanges('/live', async () => {
      runs += 1
      if (runs === 1) await new Promise((resolve) => { finish = resolve })
    })
    source.emit('open')
    source.emit('change')
    source.emit('change')
    assert.equal(runs, 1)
    finish()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(runs, 2)
    stop()
    assert.equal(source.closed, true)
  } finally {
    globalThis.EventSource = original
  }
})
