import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const schedulerUrl = new URL('../src/scheduler.ts', import.meta.url).href

// Separate processes keep timezone changes out of other tests and exercise
// the real scheduler rather than a duplicate date helper.
for (const [timezone, cases] of [
  ['America/New_York', [['2026-11-01T01:55:00-04:00', 25], ['2026-03-08T01:55:00-05:00', 23]]],
  ['Europe/Berlin', [['2026-10-25T02:55:00+02:00', 25], ['2026-03-29T01:55:00+01:00', 23]]],
  ['UTC', [['2026-11-01T05:55:00Z', 24], ['2026-03-08T06:55:00Z', 24]]],
]) {
  test(`minute retries use elapsed time and successful reviews use calendar days in ${timezone}`, () => {
    const script = `
      import assert from 'node:assert/strict'
      import { scheduleReview, getReviewDueAt } from ${JSON.stringify(schedulerUrl)}
      for (const [iso, expectedHours] of ${JSON.stringify(cases)}) {
        const at = new Date(iso)
        const card = {
          id:'clock-test', prompt:'Wohnung', status:'active', dueAt:iso,
          intervalDays:0, repetitions:0, easeFactor:2.5, lapses:0,
          lastReviewedAt:null, lastRating:null, correctCount:0, incorrectCount:0,
          reviewHistory:[], updatedAt:iso,
        }
        const scheduled = getReviewDueAt({ ...card, firstReviewScheduledAt: at.toISOString() })
        assert.equal(Date.parse(scheduled) - at.getTime(), 600_000)
        for (const mode of ['recall', 'choice', 'production']) {
          const result = scheduleReview(card, 'again', at, [], mode, mode === 'recall' ? undefined : false)
          assert.equal(result.dueAt, scheduled)
        }
        for (const rating of ['hard', 'good', 'easy']) {
          const result = scheduleReview(card, rating, at)
          const due = new Date(result.dueAt)
          const expected = new Date(at)
          expected.setDate(expected.getDate() + (rating === 'easy' ? 3 : 1))
          assert.equal(due.toISOString(), expected.toISOString())
          assert.equal(due.getHours(), at.getHours())
          assert.equal(due.getMinutes(), at.getMinutes())
          if (rating !== 'easy') assert.equal((due - at) / 3_600_000, expectedHours)
        }
        assert.equal(card.reviewHistory.length, 0)
        assert.equal(at.toISOString(), new Date(iso).toISOString())
      }
    `
    const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    })
    assert.equal(output, '')
  })
}
