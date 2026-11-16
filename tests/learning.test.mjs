import test from 'node:test'
import assert from 'node:assert/strict'
import { isDeckCard } from '../src/deckImport.ts'
import { reviewLearningCard, saveForLearning, scheduleFirstReview } from '../src/learning.ts'
import { mergeAccountCards } from '../src/accountSync.ts'
import { getRecording } from '../src/pronunciation.ts'
import { getInitialStudyMode, getNewCardQuotaRemaining, getReviewDueAt, getSessionCardIds, resetReviewProgress } from '../src/scheduler.ts'

const card = {
  id: 'one', prompt: 'das Haus', article: 'das', meaning: 'house', plural: 'die Häuser',
  example: 'Das Haus ist groß.', translation: 'The house is big.', category: 'noun',
  tags: ['A1'], status: 'active', dueAt: '2026-01-01T00:00:00.000Z',
  intervalDays: 0, repetitions: 0, easeFactor: 2.5, lapses: 0,
  lastReviewedAt: null, lastRating: null, correctCount: 0, incorrectCount: 0,
  reviewHistory: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

test('saving for learning preserves the schedule and survives card validation', () => {
  assert.equal(isDeckCard(card), true)
  const saved = saveForLearning(card, new Date('2026-01-02T00:00:00.000Z'))
  assert.equal(isDeckCard(saved), true)
  assert.equal(saved.learning.saved, true)
  assert.equal(saved.dueAt, card.dueAt)
  assert.equal(saved.lastReviewedAt, null)
  assert.deepEqual(saved.reviewHistory, [])
  assert.equal(isDeckCard({ ...saved, learning: { saved: 'yes', updatedAt: 'invalid' } }), false)
})

test('a first review on another device clears an older unsynced save', () => {
  const saved = saveForLearning(card, new Date('2026-01-02T00:00:00.000Z'))
  const reviewedWithoutSave = reviewLearningCard(card, 'good', new Date('2026-01-03T00:00:00.000Z'))
  for (const merged of [mergeAccountCards([saved], [reviewedWithoutSave]), mergeAccountCards([reviewedWithoutSave], [saved])]) {
    assert.equal(merged[0].learning.saved, false)
    assert.equal(merged[0].reviewHistory.length, 1)
  }
})

test('verified recordings match nouns, not unrelated cards or phrases', () => {
  assert.equal(getRecording(card)?.author, 'Kampy')
  assert.equal(getRecording({ ...card, category: 'verb', prompt: 'Haus' }), undefined)
  assert.equal(getRecording({ ...card, prompt: 'das Haus bauen' }), undefined)
  assert.equal(getRecording({ ...card, prompt: 'das unbekannte Wort' }), undefined)
})

test('the first submitted review clears saved learning and records the selected mode', () => {
  const saved = saveForLearning(card, new Date('2026-01-02T00:00:00.000Z'))
  const reviewed = reviewLearningCard(saved, 'hard', new Date('2026-01-03T00:00:00.000Z'), [], 'choice', true)
  assert.equal(reviewed.learning.saved, false)
  assert.equal(reviewed.reviewHistory.length, 1)
  assert.equal(reviewed.reviewHistory[0].mode, 'choice')
  assert.equal(reviewed.reviewHistory[0].answerCorrect, true)
  assert.equal(reviewed.lastReviewedAt, '2026-01-03T00:00:00.000Z')
})

test('sync merges learning state separately from review scheduling', () => {
  const saved = saveForLearning(card, new Date('2026-01-02T00:00:00.000Z'))
  const reviewed = reviewLearningCard(saved, 'again', new Date('2026-01-03T00:00:00.000Z'))
  const staleSaved = saveForLearning(card, new Date('2026-01-02T12:00:00.000Z'))
  const merged = mergeAccountCards([staleSaved], [reviewed])[0]
  assert.equal(merged.learning.saved, false)
  assert.equal(merged.lastRating, 'again')
  assert.equal(merged.reviewHistory.length, 1)

  const newerSave = saveForLearning(card, new Date('2026-01-04T00:00:00.000Z'))
  const withNewerLearning = mergeAccountCards([newerSave], [reviewed])[0]
  assert.equal(withNewerLearning.learning.saved, true)
  assert.equal(withNewerLearning.lastRating, 'again')
})

test('adding a word schedules an unscored first review and consumes today’s target', () => {
  const start = new Date('2026-01-02T12:00:00.000Z')
  const scheduled = scheduleFirstReview(saveForLearning(card, start), start)
  const other = { ...card, id: 'other', prompt: 'die Zeit' }
  assert.equal(isDeckCard(scheduled), true)
  assert.equal(scheduled.learning.saved, false)
  assert.equal(scheduled.lastReviewedAt, null)
  assert.deepEqual(scheduled.reviewHistory, [])
  assert.equal(scheduled.correctCount, 0)
  assert.equal(getReviewDueAt(scheduled), '2026-01-02T12:10:00.000Z')
  assert.equal(getNewCardQuotaRemaining([scheduled, other], start, 1), 0)
  assert.deepEqual(getSessionCardIds([scheduled], new Date('2026-01-02T12:09:59.999Z')), [])
  assert.deepEqual(getSessionCardIds([scheduled, other], new Date('2026-01-02T12:10:00.000Z'), 1), ['one', 'other'])
  assert.equal(getInitialStudyMode([scheduled, other], new Date('2026-01-02T12:10:00.000Z')), 'recall')
  const reviewed = reviewLearningCard(scheduled, 'good', new Date('2026-01-03T12:00:00.000Z'))
  assert.equal(getNewCardQuotaRemaining([reviewed, other], new Date('2026-01-03T12:00:00.000Z'), 1), 1)
  assert.equal(reviewed.reviewHistory.length, 1)
})

test('scheduled reviews survive sync and stale data cannot restore a reset schedule', () => {
  const start = new Date('2026-01-02T12:00:00.000Z')
  const scheduled = scheduleFirstReview(card, start)
  for (const [left, right] of [[scheduled, card], [card, scheduled]]) {
    const merged = mergeAccountCards([left], [right])[0]
    assert.equal(getReviewDueAt(merged), '2026-01-02T12:10:00.000Z')
    assert.equal(merged.lastReviewedAt, null)
  }
  const reviewed = reviewLearningCard(scheduled, 'good', new Date('2026-01-02T12:10:00.000Z'))
  const reset = resetReviewProgress(reviewed, new Date('2026-01-03T12:00:00.000Z'))
  assert.equal(mergeAccountCards([scheduled], [reset])[0].firstReviewScheduledAt, undefined)
  const rescheduled = scheduleFirstReview(reset, new Date(reset.reviewResetAt))
  const merged = mergeAccountCards([rescheduled], [reviewed])[0]
  assert.equal(merged.firstReviewScheduledAt, '2026-01-03T12:00:00.001Z')
  assert.equal(merged.lastReviewedAt, null)
})
