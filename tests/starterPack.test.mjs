import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseDeckImport } from '../src/deckImport.ts'

const starterPack = JSON.parse(
  readFileSync(new URL('../src/data/german-starter-pack.json', import.meta.url), 'utf8'),
)

test('starter pack contains a large, complete, deduplicated topical vocabulary set', () => {
  const cards = starterPack.cards
  const ids = new Set(cards.map((card) => card.id))
  const topics = new Set()
  const categories = new Set()

  assert.ok(cards.length >= 2500)
  assert.ok(starterPack.sourceFiles.includes('freqs/de_kaikki_words.txt'))
  assert.ok(cards.some((card) => card.tags.includes('Core vocabulary')))
  assert.equal(ids.size, cards.length)

  for (const card of cards) {
    categories.add(card.category)
    for (const tag of card.tags) {
      if (!['Open starter', 'A1', 'A2', card.category].includes(tag)) topics.add(tag)
    }

    assert.ok(card.word.trim())
    assert.ok(card.meaning.trim())
    assert.ok(card.example.trim())
    assert.ok(card.translation.trim())
    assert.ok(['A1', 'A2'].includes(card.level))
    assert.ok(card.tags.includes('Open starter'))
    assert.ok(card.tags.includes(card.level))
    assert.ok(!card.example.includes('<w>'))
    assert.ok(card.example.length <= 240)
    assert.ok(card.translation.length <= 240)

    if (card.category === 'noun') {
      assert.ok(['der', 'die', 'das'].includes(card.article))
      assert.equal(card.word[0], card.word[0].toLocaleUpperCase('de-DE'))
    }
  }

  for (const category of ['noun', 'verb', 'adjective', 'adverb', 'numeral']) {
    assert.ok(categories.has(category), `starter pack should include ${category} cards`)
  }
  assert.ok(topics.size >= 10)
})

test('starter pack can be added through the normal vocabulary-import path', () => {
  const parsed = parseDeckImport(starterPack, new Date('2026-01-01T12:00:00.000Z'))

  assert.equal(parsed.kind, 'vocabulary')
  assert.equal(parsed.cards.length, starterPack.cards.length)
  assert.ok(parsed.cards.some((card) => card.category === 'adverb'))
  assert.ok(parsed.cards.some((card) => card.category === 'numeral'))
})
