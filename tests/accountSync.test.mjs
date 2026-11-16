import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeAccountCards, mergeAccountProgress } from '../src/accountSync.ts'

const card = (overrides = {}) => ({
  id: 'card-1',
  prompt: 'das Haus',
  article: 'das',
  meaning: 'house',
  plural: 'die Häuser',
  example: 'Das Haus ist groß.',
  translation: 'The house is big.',
  category: 'noun',
  tags: ['A1'],
  status: 'active',
  dueAt: '2026-11-16T00:00:00.000Z',
  intervalDays: 1,
  repetitions: 1,
  easeFactor: 2.5,
  lapses: 0,
  lastReviewedAt: '2026-11-15T00:00:00.000Z',
  lastRating: 'good',
  correctCount: 1,
  incorrectCount: 0,
  reviewHistory: [{
    at: '2026-11-15T00:00:00.000Z',
    rating: 'good',
    intervalDays: 1,
    easeFactor: 2.5,
  }],
  createdAt: '2026-11-14T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
  ...overrides,
})

test('merges cards from both devices and keeps the newest schedule and unique history', () => {
  const local = card({
    tags: ['A1', 'Lesson 1'],
    reviewHistory: [
      card().reviewHistory[0],
      { at: '2026-11-15T12:00:00.000Z', rating: 'hard', intervalDays: 1, easeFactor: 2.4 },
    ],
    lastReviewedAt: '2026-11-15T12:00:00.000Z',
    updatedAt: '2026-11-15T12:00:00.000Z',
    intervalDays: 1,
    lastRating: 'hard',
  })
  const remote = card({
    tags: ['vhs-Lernportal'],
    reviewHistory: [card().reviewHistory[0]],
  })
  const merged = mergeAccountCards([local], [remote])[0]

  assert.equal(merged.lastRating, 'hard')
  assert.deepEqual(merged.tags, ['A1', 'Lesson 1', 'vhs-Lernportal'])
  assert.equal(merged.reviewHistory.length, 2)
  assert.equal(merged.correctCount, 2)
})

test('preserves archived cards and cards that exist on only one device', () => {
  const archived = card({ status: 'archived', lastReviewedAt: null })
  const remoteOnly = card({ id: 'remote-only', prompt: 'der Weg' })
  const merged = mergeAccountCards([archived], [card(), remoteOnly])

  assert.equal(merged.find((item) => item.id === 'card-1')?.status, 'archived')
  assert.ok(merged.some((item) => item.id === 'remote-only'))
})

test('chooses the selected source for study-plan settings while merging cards', () => {
  const local = {
    cards: [card()],
    studyPlan: { currentLevel: 'A1', targetLevel: 'B1', targetDate: '2027-01-01', intensity: 'steady' },
  }
  const remote = {
    cards: [card({ id: 'remote-only', prompt: 'der Weg' })],
    studyPlan: { currentLevel: 'A2', targetLevel: 'B2', targetDate: '2027-02-01', intensity: 'focused' },
  }

  assert.equal(mergeAccountProgress(local, remote, true).studyPlan.intensity, 'steady')
  assert.equal(mergeAccountProgress(local, remote, false).studyPlan.intensity, 'focused')
  assert.equal(mergeAccountProgress(local, remote, false).cards.length, 2)
})
