import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyLearnHistory, moveLearnHistory, visitLearnWord } from '../src/learnNavigation.ts'

test('previous and next retrace visited words and skip unavailable cards', () => {
  let history = emptyLearnHistory()
  for (const id of ['one', 'two', 'three']) history = visitLearnWord(history, id)
  const available = new Set(['one', 'three'])
  const previous = moveLearnHistory(history, -1, available)
  assert.equal(previous.ids[previous.index], 'one')
  const next = moveLearnHistory(previous, 1, available)
  assert.equal(next.ids[next.index], 'three')
  assert.equal(moveLearnHistory(next, 1, available), null)
})

test('selecting a different word after going back starts a new path', () => {
  let history = emptyLearnHistory()
  for (const id of ['one', 'two', 'three']) history = visitLearnWord(history, id)
  history = moveLearnHistory(history, -1, new Set(history.ids))
  history = visitLearnWord(history, 'four')
  assert.deepEqual(history.ids, ['one', 'two', 'four'])
  assert.equal(moveLearnHistory(history, 1, new Set(history.ids)), null)
})

test('history can return to the last word after the list becomes empty', () => {
  const history = visitLearnWord(emptyLearnHistory(), 'one')
  const pastEnd = { ...history, index: history.ids.length }
  const previous = moveLearnHistory(pastEnd, -1, new Set(['one']))
  assert.equal(previous.ids[previous.index], 'one')
})
