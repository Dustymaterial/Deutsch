import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultPauseState, finishPause, isPauseState, recordPauseWord, restorePause,
  startPendingPause, updatePauseSettings,
} from '../src/studyPause.ts'

test('three distinct completed words start a skippable 60-second pause', () => {
  let state = defaultPauseState()
  state = recordPauseWord(state, 'a', 1000, false, 'learn')
  state = recordPauseWord(state, 'a', 2000, false, 'recall')
  state = recordPauseWord(state, 'b', 3000, false, 'learn')
  assert.equal(state.until, null)
  state = recordPauseWord(state, 'c', 4000, false, 'recall')
  assert.equal(state.until, 64000)
  assert.deepEqual(state.completedIds, [])
  assert.equal(recordPauseWord(state, 'd', 5000, false, 'recall'), state)
  assert.deepEqual(finishPause(state), defaultPauseState())
})

test('quiz pauses wait for feedback and restore safely after reload or elapsed time', () => {
  let state = defaultPauseState()
  for (const id of ['a', 'b', 'c']) state = recordPauseWord(state, id, 1000, true, 'choice')
  assert.equal(state.pending, true)
  assert.equal(state.until, null)
  const started = startPendingPause(state, 5000)
  assert.equal(started.until, 65000)
  assert.deepEqual(restorePause(state, 5000), started)
  assert.equal(restorePause(started, 64999).until, 65000)
  assert.deepEqual(restorePause(started, 65000), defaultPauseState())
})

test('settings reset the count and disabling pauses prevents counting', () => {
  const counted = recordPauseWord(defaultPauseState(), 'a', 0, false, 'learn')
  assert.equal(updatePauseSettings(counted, { ...counted.settings }), counted)
  const settings = { enabled: false, every: 5, seconds: 30 }
  const disabled = updatePauseSettings(counted, settings)
  assert.deepEqual(disabled.completedIds, [])
  assert.equal(recordPauseWord(disabled, 'b', 0, false, 'learn'), disabled)
  assert.equal(isPauseState(disabled), true)
  assert.equal(isPauseState({ ...disabled, until: 'tomorrow' }), false)
})

test('custom frequency and duration apply to the next pause', () => {
  let state = updatePauseSettings(defaultPauseState(), { enabled: true, every: 5, seconds: 30 })
  for (const id of ['a', 'b', 'c', 'd']) state = recordPauseWord(state, id, 1000, false, 'learn')
  assert.equal(state.until, null)
  state = recordPauseWord(state, 'e', 1000, false, 'production')
  assert.equal(state.until, 31000)
  assert.equal(state.activity, 'production')
})
