import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { PersistentChatCache, clearChatCache, chatCacheEnabled, setChatCacheEnabled } from '../src/chatPersistentCache.ts'
import { isCachedPrivateMessage } from '../src/chatCacheValidation.ts'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const errors = []
const cache = (account, kind = 'private', enabled = true) =>
  new PersistentChatCache(account, kind, enabled, (value) => typeof value === 'string', (error) => errors.push(error))
const page = (...messages) => ({ messages, hasMore: false })
const flush = async (instance) => { await instance.queue }

test('reopening a workspace restores review summaries synchronously before disk hydration', async () => {
  await clearChatCache()
  const summary = { id: 'summary', kind: 'practice', text: 'Review session ended.', senderId: 'learner', createdAt: new Date().toISOString(), isMine: true, reported: false, reactions: [] }
  const first = new PersistentChatCache('summary', 'private', true, isCachedPrivateMessage, (error) => errors.push(error))
  await first.whenReady()
  first.set('chat', { messages: [summary], hasMore: false, cursor: 'cursor' })
  const reopened = new PersistentChatCache('summary', 'private', false, isCachedPrivateMessage, (error) => errors.push(error))
  assert.deepEqual(reopened.get('chat')?.messages, [summary])
  await flush(first)
  await reopened.start()
  assert.equal(reopened.get('chat')?.cursor, 'cursor')
  assert.equal(isCachedPrivateMessage({ ...summary, kind: 'unknown' }), false)
  assert.equal(isCachedPrivateMessage({ ...summary, createdAt: 'bad' }), false)
  await clearChatCache('summary')
  const cleared = new PersistentChatCache('summary', 'private', false, isCachedPrivateMessage, () => {})
  assert.equal(cleared.get('chat'), null)
})

test('identical live pages do not queue another disk write', async () => {
  const instance = cache('unchanged')
  await instance.whenReady()
  instance.set('chat', page('saved'))
  await flush(instance)
  const queued = instance.queue
  instance.set('chat', page('saved'))
  assert.equal(instance.queue, queued)
})

test('persistent chat cache isolates accounts and kinds and bounds saved pages', async () => {
  await clearChatCache()
  const first = cache('one')
  const other = cache('two')
  const group = cache('one', 'group')
  await Promise.all([first.whenReady(), other.whenReady(), group.whenReady()])
  first.set('chat', page(...Array.from({ length: 60 }, (_, i) => String(i))))
  other.set('chat', page('other account'))
  group.set('chat', page('group'))
  await Promise.all([flush(first), flush(other), flush(group)])
  const reloaded = cache('one')
  const reloadedOther = cache('two')
  const reloadedGroup = cache('one', 'group')
  await Promise.all([reloaded.whenReady(), reloadedOther.whenReady(), reloadedGroup.whenReady()])
  assert.deepEqual(reloaded.get('chat'), { messages: Array.from({ length: 50 }, (_, i) => String(i + 10)), hasMore: true })
  assert.deepEqual(reloadedOther.get('chat'), page('other account'))
  assert.deepEqual(reloadedGroup.get('chat'), page('group'))

  const now = Date.now()
  for (let i = 0; i < 21; i++) first.set(`chat-${i}`, page(String(i)), now + i - 21)
  await flush(first)
  const bounded = cache('one')
  await bounded.whenReady()
  assert.equal(bounded.get('chat-0'), null)
  assert.deepEqual(bounded.get('chat-20'), page('20'))
  assert.equal(errors.length, 0)
})

test('a replay cursor persists with the bounded page and is cleared with its account', async () => {
  await clearChatCache()
  const instance = cache('replay')
  await instance.whenReady()
  instance.set('chat', { ...page(...Array.from({ length: 60 }, (_, i) => String(i))), cursor: 'signed-cursor' })
  await flush(instance)
  const reloaded = cache('replay')
  await reloaded.whenReady()
  assert.equal(reloaded.get('chat').cursor, 'signed-cursor')
  assert.equal(reloaded.get('chat').messages.length, 50)
  await clearChatCache('replay')
  const cleared = cache('replay')
  await cleared.whenReady()
  assert.equal(cleared.get('chat'), null)
})

test('hydration respects expiry, invalid data, and changes made while it is in flight', async () => {
  await clearChatCache()
  const original = cache('hydrate')
  await original.whenReady()
  original.set('expired', page('old'), Date.now() - 24 * 60 * 60 * 1000)
  original.set('invalid', page(42))
  original.set('keep', page('old'))
  original.set('remove', page('remove'))
  await flush(original)
  const reloaded = cache('hydrate')
  reloaded.retain(new Set(['expired', 'invalid', 'keep']))
  reloaded.set('keep', page('new'))
  await reloaded.whenReady()
  await flush(reloaded)
  assert.equal(reloaded.get('expired'), null)
  assert.equal(reloaded.get('invalid'), null)
  assert.equal(reloaded.get('remove'), null)
  assert.deepEqual(reloaded.get('keep'), page('new'))
  assert.equal(errors.length, 0)
})

test('clearing invalidates old writers and does not remove another account', async () => {
  await clearChatCache()
  const old = cache('old')
  const other = cache('other')
  await Promise.all([old.whenReady(), other.whenReady()])
  old.set('before', page('secret'))
  other.set('chat', page('safe'))
  await Promise.all([flush(old), flush(other)])
  await clearChatCache('old')
  old.set('after', page('must not return'))
  await flush(old)
  assert.match(errors.pop().message, /cleared in another session/)
  const fresh = cache('old')
  const freshOther = cache('other')
  await Promise.all([fresh.whenReady(), freshOther.whenReady()])
  assert.equal(fresh.get('before'), null)
  assert.equal(fresh.get('after'), null)
  assert.deepEqual(freshOther.get('chat'), page('safe'))
  assert.equal(errors.length, 0)
})

test('disabled storage can be re-enabled and storage failures are reported', async () => {
  await clearChatCache()
  assert.equal(chatCacheEnabled(), true)
  setChatCacheEnabled(false)
  assert.equal(chatCacheEnabled(), false)
  const instance = cache('setting', 'private', false)
  instance.set('offline', page('memory only'))
  await flush(instance)
  const empty = cache('setting')
  await empty.whenReady()
  assert.equal(empty.get('offline'), null)
  await instance.start()
  instance.set('saved', page('saved'))
  await flush(instance)
  const reloaded = cache('setting')
  await reloaded.whenReady()
  assert.deepEqual(reloaded.get('saved'), page('saved'))
  instance.stop()
  await clearChatCache('setting')
  instance.set('later', page('not saved'))
  await flush(instance)
  const cleared = cache('setting')
  await cleared.whenReady()
  assert.equal(cleared.get('saved'), null)
  assert.equal(cleared.get('later'), null)

  const original = globalThis.indexedDB
  globalThis.indexedDB = { open() { throw new Error('storage denied') } }
  const failing = cache('denied')
  await failing.whenReady()
  assert.match(errors.pop().message, /storage denied/)
  globalThis.indexedDB = original
  setChatCacheEnabled(true)
  assert.equal(errors.length, 0)
})

test('stopping an in-flight hydration prevents it from restoring a cleared page', async () => {
  await clearChatCache()
  const first = cache('race')
  await first.whenReady()
  first.set('chat', page('secret'))
  await flush(first)
  const pending = cache('race')
  pending.stop()
  await clearChatCache('race')
  await pending.start()
  assert.equal(pending.get('chat'), null)
  assert.equal(errors.length, 0)
})
