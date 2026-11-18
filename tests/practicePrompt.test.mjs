import { test } from 'node:test'
import assert from 'node:assert/strict'
import { practicePrompt } from '../src/practicePrompt.ts'

test('practice displays an article once without changing the saved prompt', () => {
  assert.equal(practicePrompt('das Lebensmittel', 'das'), 'das Lebensmittel')
  assert.equal(practicePrompt('Lebensmittel', 'das'), 'das Lebensmittel')
  assert.equal(practicePrompt('Das Lebensmittel', 'das'), 'Das Lebensmittel')
  assert.equal(practicePrompt('lernen'), 'lernen')
})
