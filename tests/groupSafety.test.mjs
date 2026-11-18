import test from 'node:test'
import assert from 'node:assert/strict'
import { groupContentSafety, queueSafetyReport } from '../server/groupSafety.js'

test('group language holds match whole normalized words without guessing intent', () => {
  for (const text of ['You ASSHOLE!', 'Ein Arschloch.', 'Ａｒｓｃｈｌｏｃｈ', 'arsch\u200bloch']) assert.equal(groupContentSafety(text).hold, true)
  for (const text of ['Der Fuchs läuft.', 'Das Fach ist wichtig.', 'class assignment', 'Arschlochtheorie', 'Scheiße, ich habe den Bus verpasst.']) assert.equal(groupContentSafety(text).hold, false)
  assert.equal(groupContentSafety('Was bedeutet „Arschloch“?').hold, true)
})

test('links produce warnings, not language holds, and are never fetched', () => {
  assert.deepEqual(groupContentSafety('https://example.com/path?q=test'), { hold: false, hasLinks: true })
  assert.deepEqual(groupContentSafety('WWW.example.com'), { hold: false, hasLinks: true })
  assert.deepEqual(groupContentSafety('Ein Baum.'), { hold: false, hasLinks: false })
})

test('a stale pending snapshot cannot reopen a resolved or newer language report', async () => {
  const now = new Date()
  for (const report of [{ createdAt: now, status: 'resolved' }, { createdAt: new Date(now.getTime() + 1), status: 'open' }]) {
    await queueSafetyReport({ findOne: async () => report, updateOne: async () => assert.fail('stale report was reopened') },
      { _id: 'group', name: 'Group' }, { _id: 'message', hiddenBy: 'safety-filter', safetyStatus: 'pending', hiddenAt: now })
  }
})
