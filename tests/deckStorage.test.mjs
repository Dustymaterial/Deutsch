import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { commitDeckChanges, mergeStoredAccountDeck, replaceStoredDeck, DeckConflictError } from '../src/deckStorage.ts'
import { makeCard, deckStorageKey } from '../src/starterDeck.ts'
import { scheduleReview, getNewCardQuotaRemaining } from '../src/scheduler.ts'
import { scheduleFirstReview } from '../src/learning.ts'
const at = new Date('2026-11-19T10:00:00Z')
const base = () => ['Haus', 'Buch'].map((word, index) => makeCard(`card-${index}`, `das ${word}`, word, 'Das ist hier.', 'It is here.', 'noun', [], { article: 'das' }))
function fixture(cards, locks) {
  const data = new Map([[deckStorageKey, JSON.stringify(cards)]])
  return { storage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }, locks, indexedDB, data }
}
function mockLocks() {
  let pending = Promise.resolve()
  return { request: (_name, _options, action) => { const next = pending.then(action); pending = next.catch(() => {}); return next } }
}
for (const kind of ['web-lock', 'indexeddb-fallback']) test(`different tabs preserve disjoint reviews through ${kind}`, async () => {
  const cards = base(), env = fixture(cards, kind === 'web-lock' ? mockLocks() : undefined)
  const a = cards.map((card, i) => i === 0 ? scheduleReview(card, 'good', at) : card)
  const b = cards.map((card, i) => i === 1 ? scheduleReview(card, 'hard', at) : card)
  await Promise.all([commitDeckChanges(cards, a, env), commitDeckChanges(cards, b, env)])
  assert.deepEqual(JSON.parse(env.storage.getItem(deckStorageKey)).map((card) => card.reviewHistory.length), [1, 1])
})
test('same-word conflicts do not overwrite or double-count a review', async () => {
  const cards = base(), env = fixture(cards)
  const changed = cards.map((card, i) => i === 0 ? scheduleReview(card, 'good', at) : card)
  const competing = cards.map((card, i) => i === 0 ? scheduleReview(card, 'again', at) : card)
  const result = await Promise.allSettled([commitDeckChanges(cards, changed, env), commitDeckChanges(cards, competing, env)])
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1)
  assert.ok(result.find((item) => item.status === 'rejected').reason instanceof DeckConflictError)
  assert.equal(JSON.parse(env.storage.getItem(deckStorageKey))[0].reviewHistory.length, 1)
})
test('cloud merge and destructive replacement cannot erase another tab changes', async () => {
  const cards = base(), env = fixture(cards)
  const updated = cards.map((card, i) => i === 0 ? scheduleReview(card, 'good', at) : card)
  await commitDeckChanges(cards, updated, env)
  await assert.rejects(replaceStoredDeck(cards, [], env), DeckConflictError)
  const merged = await mergeStoredAccountDeck(cards, [makeCard('remote', 'lernen', 'learn', 'Ich lerne.', 'I learn.', 'verb', [])], env)
  assert.equal(merged.find((card) => card.id === cards[0].id).reviewHistory.length, 1)
  assert.ok(merged.some((card) => card.id === 'remote'))
})
test('the daily allowance is checked inside the shared commit boundary', async () => {
  const cards = base(), env = fixture(cards)
  const validator = (latest) => { if (!getNewCardQuotaRemaining(latest, at, 1)) throw new Error('Target complete') }
  const results = await Promise.allSettled(cards.map((target) => commitDeckChanges(cards,
    cards.map((card) => card.id === target.id ? scheduleFirstReview(card, at) : card), env, validator)))
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(getNewCardQuotaRemaining(JSON.parse(env.storage.getItem(deckStorageKey)), at, 1), 0)
})
test('invalid saved data and persistence failures leave existing storage intact', async () => {
  const cards = base(), env = fixture(cards)
  env.data.set(deckStorageKey, 'invalid')
  await assert.rejects(commitDeckChanges(cards, cards, env))
  assert.equal(env.storage.getItem(deckStorageKey), 'invalid')
  const broken = fixture(cards)
  broken.storage.setItem = () => { throw new Error('Quota exceeded') }
  await assert.rejects(commitDeckChanges(cards, cards, broken), /Quota/)
  assert.deepEqual(JSON.parse(broken.storage.getItem(deckStorageKey)), cards)
})
test('property ordering is not a conflict and cancelled sync cannot write', async () => {
  const cards = base(), env = fixture(cards)
  env.data.set(deckStorageKey, JSON.stringify(cards.map((card) => Object.fromEntries(Object.entries(card).reverse()))))
  const changed = cards.map((card, index) => index === 0 ? scheduleReview(card, 'good', at) : card)
  await commitDeckChanges(cards, changed, env)
  const saved = env.storage.getItem(deckStorageKey)
  await assert.rejects(mergeStoredAccountDeck(cards, cards, env, () => false), { name: 'AbortError' })
  assert.equal(env.storage.getItem(deckStorageKey), saved)
})
