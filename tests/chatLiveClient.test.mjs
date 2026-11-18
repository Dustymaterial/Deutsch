import test from 'node:test'
import assert from 'node:assert/strict'
import { watchChatChanges } from '../src/chatLive.ts'

test('polls only while disconnected and refreshes immediately on live changes and reconnect', async () => {
  const original = { EventSource: globalThis.EventSource, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  const timers = new Map()
  let source
  globalThis.setInterval = (callback) => { const id = Symbol(); timers.set(id, callback); return id }
  globalThis.clearInterval = (id) => timers.delete(id)
  globalThis.EventSource = class {
    handlers = new Map()
    constructor() { source = this }
    addEventListener(name, callback) { this.handlers.set(name, callback) }
    close() {}
    emit(name) { this.handlers.get(name)() }
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  try {
    let refreshes = 0
    const stop = watchChatChanges('/live', () => { refreshes++ })
    assert.equal(timers.size, 1)
    source.emit('open')
    await tick()
    assert.equal(timers.size, 0)
    source.emit('change')
    await tick()
    assert.equal(refreshes, 2)
    source.emit('error')
    source.emit('error')
    assert.equal(timers.size, 1)
    timers.values().next().value()
    await tick()
    assert.equal(refreshes, 3)
    source.emit('open')
    await tick()
    assert.equal(timers.size, 0)
    assert.equal(refreshes, 4)
    stop()
    assert.equal(timers.size, 0)
  } finally { Object.assign(globalThis, original) }
})

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
