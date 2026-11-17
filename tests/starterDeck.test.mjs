import test from 'node:test'
import assert from 'node:assert/strict'
import { deckStorageKey, loadDeck, makeCard } from '../src/starterDeck.ts'

test('a saved deck loads without replacing its cards or progress', async () => {
  const saved = makeCard('saved', 'Haus', 'house', 'Das ist ein Haus.', 'That is a house.', 'noun', ['A1'], { article: 'das' })
  saved.repetitions = 3
  globalThis.localStorage = { getItem: (key) => key === deckStorageKey ? JSON.stringify([saved]) : null }
  const loaded = await loadDeck()
  assert.equal(loaded.warning, null)
  assert.equal(loaded.canSave, true)
  assert.equal(loaded.cards.length, 1)
  assert.equal(loaded.cards[0].id, 'saved')
  assert.equal(loaded.cards[0].repetitions, 3)
})

