import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDefaultStudyPlan,
  estimateGoalPace,
  INTENSITY_SETTINGS,
  isStudyPlan,
} from '../src/studyPlan.ts'

test('default plan gives an editable three-month B1 intensive goal', () => {
  const plan = createDefaultStudyPlan(new Date('2026-01-01T12:00:00'))

  assert.equal(plan.targetLevel, 'B1')
  assert.equal(plan.currentLevel, 'unknown')
  assert.equal(plan.targetDate, '2026-04-01')
  assert.equal(plan.intensity, 'intensive')
  assert.equal(INTENSITY_SETTINGS[plan.intensity].newCardsPerDay, 15)
})

test('goal estimate uses current and target levels and days remaining', () => {
  const estimate = estimateGoalPace(
    {
      currentLevel: 'A1',
      targetLevel: 'B1',
      targetDate: '2026-04-01',
      intensity: 'intensive',
    },
    new Date('2026-01-01T12:00:00'),
  )

  assert.equal(estimate.daysRemaining, 90)
  assert.deepEqual(estimate.guidedHours, { min: 110, max: 430 })
  assert.deepEqual(estimate.guidedHoursPerDay, { min: 110 / 90, max: 430 / 90 })
})

test('unknown starting level does not pretend to predict a study-hour range', () => {
  const plan = createDefaultStudyPlan(new Date('2026-01-01T12:00:00'))

  assert.equal(estimateGoalPace(plan, new Date('2026-01-01T12:00:00')).guidedHours, null)
})

test('study plans reject invalid dates and intensity values', () => {
  const valid = createDefaultStudyPlan(new Date('2026-01-01T12:00:00'))

  assert.equal(isStudyPlan(valid), true)
  assert.equal(isStudyPlan({ ...valid, targetDate: '2026-02-31' }), false)
  assert.equal(isStudyPlan({ ...valid, intensity: 'extreme' }), false)
})
