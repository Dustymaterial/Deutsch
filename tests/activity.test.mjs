import test from 'node:test'
import assert from 'node:assert/strict'
import { activityDayKey, activityForCard, activityDates, recordWordActivity, summarizeActivity } from '../src/activity.ts'
import { isDeckCard, parseDeckFile } from '../src/deckImport.ts'
import { mergeAccountCards } from '../src/accountSync.ts'
import { resetReviewProgress } from '../src/scheduler.ts'

const card = {
  id: 'one', prompt: 'Haus', meaning: 'house', example: 'Das Haus.', category: 'noun',
  tags: [], status: 'active', dueAt: '2026-01-01T00:00:00.000Z',
  intervalDays: 0, repetitions: 0, easeFactor: 2.5, lapses: 0, lastReviewedAt: null,
  lastRating: null, correctCount: 0, incorrectCount: 0, reviewHistory: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}

test('daily totals count a word once across additions, repeated reviews and modes', () => {
  const date = new Date(2026, 10, 16, 12)
  let first = recordWordActivity(card, 'added', date)
  first = recordWordActivity(first, 'reviewed', date)
  first = recordWordActivity(first, 'reviewed', date)
  const second = recordWordActivity({ ...card, id: 'two' }, 'reviewed', date)
  assert.deepEqual(summarizeActivity([first, second]).get('2026-11-16'), { total: 2, added: 1, reviewed: 2 })
  assert.equal(isDeckCard(first), true)
  assert.equal(isDeckCard({ ...first, activity: { added: ['2026-02-30'], reviewed: [] } }), false)
})

test('available historical activity is captured before a review reset and merged across devices', () => {
  const at = new Date(2026, 0, 3, 12)
  const legacy = { ...card, firstReviewScheduledAt: at.toISOString(), reviewHistory: [
    { at: at.toISOString(), rating: 'good', intervalDays: 1, easeFactor: 2.5 },
  ] }
  const reset = resetReviewProgress({ ...legacy, activity: activityForCard(legacy) }, new Date(2026, 0, 4))
  const other = recordWordActivity(card, 'reviewed', new Date(2026, 0, 5, 12))
  const merged = mergeAccountCards([reset], [other])[0]
  assert.deepEqual(merged.activity, { added: ['2026-01-03'], reviewed: ['2026-01-03', '2026-01-05'] })
  assert.equal(summarizeActivity([merged]).get('2026-01-03').total, 1)
  assert.deepEqual(mergeAccountCards([merged], [other])[0].activity, merged.activity)
})

test('calendar dates use local days across month boundaries', () => {
  const dates = activityDates(new Date(2026, 2, 1, 23), 3).map(activityDayKey)
  assert.deepEqual(dates, ['2026-02-27', '2026-02-28', '2026-03-01'])
})

test('activity survives a deck backup and invalid activity is rejected', () => {
  const saved = recordWordActivity(card, 'reviewed', new Date(2026, 10, 16, 12))
  const backup = { format: 'deutsch-daily-deck', version: 1, cards: [saved] }
  const parsed = parseDeckFile(JSON.stringify(backup), 'backup.json')
  assert.deepEqual(parsed.cards[0].activity, saved.activity)
  backup.cards[0] = { ...saved, activity: { added: [], reviewed: ['not-a-day'] } }
  assert.throws(() => parseDeckFile(JSON.stringify(backup), 'backup.json'))
})
