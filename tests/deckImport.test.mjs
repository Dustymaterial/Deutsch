import assert from 'node:assert/strict'
import test from 'node:test'
import { cardContentKey, isDeckCard, parseDeckImport } from '../src/deckImport.ts'

const now = new Date('2026-01-01T12:00:00.000Z')

test('simple vocabulary entries become fresh study cards with default review state', () => {
  const parsed = parseDeckImport(
    {
      format: 'deutsch-vocabulary',
      version: 1,
      cards: [
        {
          word: 'Wohnung',
          category: 'noun',
          article: 'die',
          meaning: 'apartment',
          plural: 'die Wohnungen',
          example: 'Die Wohnung ist sehr schön.',
          translation: 'The apartment is very beautiful.',
          level: 'A1',
          tags: ['home'],
        },
      ],
    },
    now,
  )

  assert.equal(parsed.kind, 'vocabulary')
  assert.equal(parsed.cards.length, 1)
  assert.equal(parsed.cards[0].prompt, 'die Wohnung')
  assert.equal(parsed.cards[0].dueAt, now.toISOString())
  assert.equal(parsed.cards[0].lastReviewedAt, null)
  assert.equal(parsed.cards[0].intervalDays, 0)
  assert.ok(parsed.cards[0].tags.includes('home'))
})

test('same vocabulary content gets a stable ID for safe repeat imports', () => {
  const payload = [
    {
      word: 'verstehen',
      category: 'verb',
      meaning: 'to understand',
      example: 'Ich verstehe das.',
    },
  ]

  const first = parseDeckImport(payload, now).cards[0]
  const repeated = parseDeckImport(payload, new Date('2026-02-01T00:00:00.000Z')).cards[0]

  assert.equal(first.id, repeated.id)
  assert.equal(cardContentKey(first), cardContentKey(repeated))
})

test('adverbs and numerals are supported vocabulary entry types', () => {
  const parsed = parseDeckImport(
    [
      {
        word: 'oft',
        category: 'adverb',
        meaning: 'often',
        example: 'Ich gehe oft spazieren.',
      },
      {
        word: 'drei',
        category: 'numeral',
        meaning: 'three',
        example: 'Ich habe drei Bücher.',
      },
    ],
    now,
  )

  assert.deepEqual(parsed.cards.map((card) => card.category), ['adverb', 'numeral'])
})

test('rejects noun entries without an explicit article', () => {
  assert.throws(
    () =>
      parseDeckImport([
        {
          word: 'Wohnung',
          category: 'noun',
          meaning: 'apartment',
          example: 'Die Wohnung ist schön.',
        },
      ]),
    /incomplete or invalid/,
  )
})

test('rejects empty or unsupported vocabulary formats', () => {
  assert.throws(() => parseDeckImport([]), /does not contain any cards/)
  assert.throws(
    () => parseDeckImport({ format: 'deutsch-vocabulary', version: 2, cards: [] }),
    /Unsupported or invalid/,
  )
})

test('saved cards accept production reviews while preserving old review records', () => {
  const card = parseDeckImport(
    [{
      word: 'Wohnung',
      category: 'noun',
      article: 'die',
      meaning: 'apartment',
      example: 'Die Wohnung ist schön.',
    }],
    now,
  ).cards[0]
  const productionReview = {
    at: now.toISOString(),
    rating: 'hard',
    intervalDays: 1,
    easeFactor: 2.4,
    mode: 'production',
    answerCorrect: true,
  }

  assert.equal(isDeckCard({ ...card, reviewHistory: [productionReview] }), true)
  assert.equal(isDeckCard({ ...card, reviewHistory: [{ ...productionReview, mode: 'other' }] }), false)
})

test('shared-word attribution is validated and survives as optional card metadata', () => {
  const card = parseDeckImport([{
    word: 'lernen',
    category: 'verb',
    meaning: 'to learn',
    example: 'Wir lernen Deutsch.',
  }]).cards[0]
  card.sharedFrom = { shareId: 'share-123', username: 'companion', sharedAt: '2026-03-01T00:00:00.000Z', note: 'A helpful word.' }
  assert.equal(isDeckCard(card), true)
  card.sharedFrom.note = 'x'.repeat(241)
  assert.equal(isDeckCard(card), false)
})
