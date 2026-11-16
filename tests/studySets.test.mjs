import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCardsForStudySet,
  getStudySetNewCardLimit,
  getStudySetProgress,
  getStudySetTags,
} from '../src/studySets.ts'

const makeCard = (id, tags, overrides = {}) => ({
  id,
  prompt: id,
  tags,
  status: 'active',
  lastReviewedAt: null,
  reviewHistory: [],
  ...overrides,
})

test('study-set tags omit automatic card metadata and archived items', () => {
  const cards = [
    makeCard('one', ['A1', 'noun', 'adverb', 'numeral', 'vhs-Lernportal', 'Lektion 1']),
    makeCard('two', ['a1', 'vhs-Lernportal', 'Themen']),
    makeCard('archived', ['Lektion 9'], { status: 'archived' }),
  ]

  assert.deepEqual(getStudySetTags(cards), ['Lektion 1', 'Themen', 'vhs-Lernportal'])
})

test('tag filtering includes only active cards tagged for the selected study set', () => {
  const cards = [
    makeCard('one', ['vhs-Lernportal', 'Lektion 1']),
    makeCard('two', ['vhs-Lernportal', 'Lektion 2']),
    makeCard('archived', ['vhs-Lernportal', 'Lektion 1'], { status: 'archived' }),
  ]

  assert.deepEqual(getCardsForStudySet(cards, 'Lektion 1').map((card) => card.id), ['one'])
  assert.equal(getCardsForStudySet(cards, '').length, 2)
})

test('a tag study set respects the whole deck daily new-card quota', () => {
  const today = new Date('2026-01-01T12:00:00.000Z')
  const studied = makeCard('studied', ['Lektion 1'], {
    lastReviewedAt: today.toISOString(),
    reviewHistory: [
      { at: today.toISOString(), rating: 'good', intervalDays: 1, easeFactor: 2.5 },
    ],
  })
  const setCards = [
    makeCard('lesson-word-1', ['Lektion 1']),
    makeCard('lesson-word-2', ['Lektion 1']),
  ]

  assert.equal(getStudySetNewCardLimit([studied, ...setCards], setCards, today, 2), 1)
})

test('study-set progress separates self-rated recall, choice, and production', () => {
  const review = (rating, mode, answerCorrect) => ({
    at: '2026-01-01T12:00:00.000Z',
    rating,
    intervalDays: 1,
    easeFactor: 2.5,
    ...(mode === undefined ? {} : { mode }),
    ...(answerCorrect === undefined ? {} : { answerCorrect }),
  })
  const cards = [
    makeCard('lesson-one-a', ['Lektion 1'], {
      reviewHistory: [
        review('again'),
        review('good', 'recall'),
        review('hard', 'choice', true),
        review('again', 'choice', false),
        review('hard', 'production', true),
      ],
    }),
    makeCard('lesson-one-b', ['Lektion 1'], {
      reviewHistory: [
        review('easy', undefined),
        review('hard', 'production', false),
        review('good', 'choice'),
      ],
    }),
    makeCard('lesson-two', ['Lektion 2'], {
      reviewHistory: [review('good', 'production', true)],
    }),
    makeCard('archived', ['Lektion 1'], {
      status: 'archived',
      reviewHistory: [review('good', 'choice', true)],
    }),
  ]

  assert.deepEqual(
    getStudySetProgress(getCardsForStudySet(cards, 'Lektion 1')),
    {
      recall: { remembered: 2, again: 1, total: 3 },
      choice: { correct: 1, answered: 2 },
      production: { correct: 1, answered: 2 },
    },
  )
})
