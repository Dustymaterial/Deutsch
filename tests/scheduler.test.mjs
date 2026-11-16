import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectWeakPattern,
  getCardsIntroducedToday,
  getInitialStudyMode,
  getNewCardQuotaRemaining,
  getSessionCardIds,
  scheduleReview,
} from '../src/scheduler.ts'

const now = new Date('2026-01-01T12:00:00.000Z')

const makeCard = (overrides = {}) => ({
  id: 'card-1',
  prompt: 'Wohnung',
  status: 'active',
  dueAt: now.toISOString(),
  intervalDays: 0,
  repetitions: 0,
  easeFactor: 2.5,
  lapses: 0,
  lastReviewedAt: null,
  lastRating: null,
  correctCount: 0,
  incorrectCount: 0,
  reviewHistory: [],
  updatedAt: now.toISOString(),
  ...overrides,
})

test('initial mode prioritizes due reviews, then unseen active cards', () => {
  const unseen = makeCard()
  const due = makeCard({ id: 'due', lastReviewedAt: '2025-12-01T00:00:00.000Z' })
  const future = makeCard({ id: 'future', lastReviewedAt: '2025-12-01T00:00:00.000Z', dueAt: '2026-01-02T12:00:00.000Z' })
  const archivedDue = { ...due, status: 'archived' }
  const archivedUnseen = { ...unseen, status: 'archived' }

  assert.equal(getInitialStudyMode([unseen, due], now), 'recall')
  assert.equal(getInitialStudyMode([unseen, future, archivedDue], now), 'learn')
  assert.equal(getInitialStudyMode([future, archivedUnseen], now), 'recall')
  assert.equal(getInitialStudyMode([], now), 'recall')
})

test('Again records a lapse and schedules a ten-minute retry', () => {
  const result = scheduleReview(makeCard(), 'again', now)

  assert.equal(result.dueAt, '2026-01-01T12:10:00.000Z')
  assert.equal(result.repetitions, 0)
  assert.equal(result.lapses, 1)
  assert.equal(result.incorrectCount, 1)
  assert.equal(result.reviewHistory.length, 1)
})

test('first successful ratings use increasing initial intervals', () => {
  const card = makeCard()
  const hard = scheduleReview(card, 'hard', now)
  const good = scheduleReview(card, 'good', now)
  const easy = scheduleReview(card, 'easy', now)

  assert.equal(hard.intervalDays, 1)
  assert.equal(good.intervalDays, 1)
  assert.equal(easy.intervalDays, 3)
  assert.ok(new Date(easy.dueAt) > new Date(good.dueAt))
  assert.equal(hard.correctCount, 1)
})

test('successful intervals grow from prior card state', () => {
  const card = makeCard({ intervalDays: 10, repetitions: 2 })
  const hard = scheduleReview(card, 'hard', now)
  const good = scheduleReview(card, 'good', now)
  const easy = scheduleReview(card, 'easy', now)

  assert.equal(hard.intervalDays, 12)
  assert.equal(good.intervalDays, 25)
  assert.equal(easy.intervalDays, 35)
})

test('same inputs produce the same scheduled state', () => {
  const card = makeCard({ intervalDays: 4, repetitions: 2 })

  assert.deepEqual(
    scheduleReview(card, 'good', now),
    scheduleReview(card, 'good', now),
  )
})

test('choice outcomes are recorded separately from free-recall ratings', () => {
  const card = makeCard()
  const recognized = scheduleReview(card, 'hard', now, [], 'choice', true)
  const missed = scheduleReview(card, 'again', now, [], 'choice', false)

  assert.equal(recognized.reviewHistory[0].mode, 'choice')
  assert.equal(recognized.reviewHistory[0].answerCorrect, true)
  assert.equal(missed.reviewHistory[0].mode, 'choice')
  assert.equal(missed.reviewHistory[0].answerCorrect, false)
  assert.equal(scheduleReview(card, 'good', now).reviewHistory[0].mode, 'recall')
})

test('typed production outcomes are recorded separately and scheduled conservatively', () => {
  const card = makeCard()
  const produced = scheduleReview(card, 'hard', now, [], 'production', true)
  const missed = scheduleReview(card, 'again', now, [], 'production', false)

  assert.equal(produced.reviewHistory[0].mode, 'production')
  assert.equal(produced.reviewHistory[0].answerCorrect, true)
  assert.equal(produced.intervalDays, 1)
  assert.equal(missed.reviewHistory[0].mode, 'production')
  assert.equal(missed.reviewHistory[0].answerCorrect, false)
  assert.equal(missed.dueAt, '2026-01-01T12:10:00.000Z')
})

test('weak-pattern suggestions require repeated, cross-card evidence', () => {
  const makeReview = (struggledWith = []) => ({
    at: now.toISOString(),
    rating: 'good',
    intervalDays: 1,
    easeFactor: 2.5,
    struggledWith,
  })
  const cards = [
    makeCard({
      id: 'noun-1',
      category: 'noun',
      article: 'die',
      plural: 'die Wohnungen',
      reviewHistory: [
        makeReview(['article']),
        makeReview(['article']),
        makeReview(),
      ],
    }),
    makeCard({
      id: 'noun-2',
      category: 'noun',
      article: 'der',
      plural: 'die Tische',
      reviewHistory: [
        makeReview(['article']),
        makeReview(),
        makeReview(),
      ],
    }),
  ]

  assert.deepEqual(detectWeakPattern(cards), {
    field: 'article',
    observations: 6,
    flaggedReviews: 3,
    affectedCards: 2,
  })
  assert.equal(detectWeakPattern([cards[0]]), null)
})

test('session includes due reviews first and caps new cards at five', () => {
  const unseen = Array.from({ length: 7 }, (_, index) =>
    makeCard({ id: `new-${index}`, prompt: `word-${index}` }),
  )
  const due = makeCard({
    id: 'due',
    prompt: 'due',
    lastReviewedAt: '2025-12-01T00:00:00.000Z',
  })
  const weakDue = makeCard({
    id: 'weak-due',
    prompt: 'weak',
    lapses: 2,
    lastReviewedAt: '2025-12-01T00:00:00.000Z',
  })
  const future = makeCard({
    id: 'future',
    prompt: 'future',
    dueAt: '2027-01-01T00:00:00.000Z',
    lastReviewedAt: '2025-12-01T00:00:00.000Z',
  })
  const archived = makeCard({ id: 'archived', status: 'archived' })

  const ids = getSessionCardIds([...unseen, due, weakDue, future, archived], now)

  assert.equal(ids.length, 7)
  assert.equal(ids[0], 'weak-due')
  assert.ok(ids.includes('due'))
  assert.ok(!ids.includes('future'))
  assert.ok(!ids.includes('archived'))
})

test('newly added unseen cards are prioritized in the next session', () => {
  const older = makeCard({
    id: 'older',
    prompt: 'alt',
    createdAt: '2025-12-01T00:00:00.000Z',
  })
  const newest = makeCard({
    id: 'newest',
    prompt: 'neu',
    createdAt: '2025-12-31T00:00:00.000Z',
  })

  assert.deepEqual(getSessionCardIds([older, newest], now), ['newest', 'older'])
})

test('session limits can be adjusted for goal-based study intensity', () => {
  const cards = Array.from({ length: 10 }, (_, index) =>
    makeCard({ id: `new-${index}`, prompt: `word-${index}` }),
  )

  assert.equal(getSessionCardIds(cards, now, 5, 30).length, 5)
  assert.equal(getSessionCardIds(cards, now, 10, 50).length, 10)
  assert.equal(getSessionCardIds(cards, now, 15, 80).length, 10)
})

test('daily new-card allowance counts first introductions once across repeated reviews', () => {
  const cards = [
    makeCard({
      id: 'introduced-today',
      lastReviewedAt: now.toISOString(),
      reviewHistory: [
        { at: now.toISOString(), rating: 'again', intervalDays: 0, easeFactor: 2.3 },
        { at: '2026-01-01T12:10:00.000Z', rating: 'hard', intervalDays: 1, easeFactor: 2.2 },
      ],
    }),
    makeCard({
      id: 'introduced-yesterday',
      lastReviewedAt: '2025-12-31T12:00:00.000Z',
      reviewHistory: [
        { at: '2025-12-31T12:00:00.000Z', rating: 'good', intervalDays: 1, easeFactor: 2.5 },
      ],
    }),
    makeCard({ id: 'unseen-1' }),
    makeCard({ id: 'unseen-2' }),
    makeCard({ id: 'unseen-3' }),
  ]

  assert.equal(getNewCardQuotaRemaining(cards, now, 3), 2)
  assert.equal(getNewCardQuotaRemaining(cards, new Date('2026-01-02T12:00:00.000Z'), 3), 3)
})

test('today review loop includes active cards first introduced today', () => {
  const cards = [
    makeCard({
      id: 'introduced-today',
      reviewHistory: [
        { at: now.toISOString(), rating: 'good', intervalDays: 1, easeFactor: 2.5 },
      ],
    }),
    makeCard({
      id: 'reviewed-today-but-introduced-earlier',
      reviewHistory: [
        { at: '2025-12-31T12:00:00.000Z', rating: 'good', intervalDays: 1, easeFactor: 2.5 },
        { at: now.toISOString(), rating: 'good', intervalDays: 1, easeFactor: 2.5 },
      ],
    }),
    makeCard({
      id: 'archived-today',
      status: 'archived',
      reviewHistory: [
        { at: now.toISOString(), rating: 'good', intervalDays: 1, easeFactor: 2.5 },
      ],
    }),
  ]

  assert.deepEqual(getCardsIntroducedToday(cards, now).map((card) => card.id), ['introduced-today'])
})

test('due reviews beyond one set remain available in the next set', () => {
  const due = Array.from({ length: 85 }, (_, index) =>
    makeCard({
      id: `due-${index}`,
      prompt: `due-${index}`,
      lastReviewedAt: '2025-12-01T12:00:00.000Z',
    }),
  )
  const newCards = [
    makeCard({ id: 'new-1', prompt: 'new-1' }),
    makeCard({ id: 'new-2', prompt: 'new-2' }),
  ]
  const firstSet = getSessionCardIds([...due, ...newCards], now, 5, 80)
  const afterFirstSet = [...due, ...newCards].map((card) =>
    firstSet.includes(card.id) ? scheduleReview(card, 'good', now) : card,
  )
  const nextSet = getSessionCardIds(afterFirstSet, now, 5, 80)

  assert.equal(firstSet.length, 80)
  assert.equal(firstSet.filter((id) => id.startsWith('due-')).length, 80)
  assert.equal(nextSet.filter((id) => id.startsWith('due-')).length, 5)
  assert.ok(nextSet.includes('new-1'))
  assert.ok(nextSet.includes('new-2'))
})
