import test from 'node:test'
import assert from 'node:assert/strict'
import { leaveChatHistory, retreatChatOverlay } from '../src/chatHistoryNavigation.ts'

test('leaving a chat waits for an in-flight overlay retreat', () => {
  const previous = globalThis.window
  const events = new EventTarget()
  const calls = []
  globalThis.window = Object.assign(events, {
    history: { back: () => calls.push('back'), go: (steps) => calls.push(steps) },
  })
  try {
    retreatChatOverlay()
    leaveChatHistory(3)
    assert.deepEqual(calls, ['back'])
    events.dispatchEvent(new Event('popstate'))
    assert.deepEqual(calls, ['back', -2])
    leaveChatHistory(1)
    assert.deepEqual(calls, ['back', -2, -1])
  } finally {
    globalThis.window = previous
  }
})
