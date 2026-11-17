import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatMemoryCache } from '../src/chatMemoryCache.ts'

test('chat cache expires pages and retains only recently used conversations', () => {
  const cache = new ChatMemoryCache(2, 2, 100)
  cache.set('a', { messages: [1, 2, 3], hasMore: false }, 0)
  cache.set('b', { messages: [4], hasMore: false }, 1)
  assert.deepEqual(cache.get('a', 2), { messages: [2, 3], hasMore: true })
  cache.set('c', { messages: [5], hasMore: false }, 3)
  assert.equal(cache.get('b', 4), null)
  assert.equal(cache.get('a', 100), null)
  cache.retain(new Set())
  assert.equal(cache.get('c', 4), null)
})
