import assert from 'node:assert/strict'
import test from 'node:test'
import { diffSentences } from '../src/sentenceDiff.ts'

const summary = (parts) => parts.map((part) => `${part.kind[0]}:${part.text}`).join(' ')

test('only the changed words are marked', () => {
  assert.equal(
    summary(diffSentences('Ich habe gestern gegangen', 'Ich bin gestern gegangen')),
    's:Ich r:habe a:bin s:gestern s:gegangen',
  )
})

test('punctuation and spacing from the suggestion are kept', () => {
  const parts = diffSentences('Ich gehe nach Hause', 'Ich gehe nach Hause.')
  assert.equal(summary(parts), 's:Ich s:gehe s:nach s:Hause a:.')
  assert.equal(parts.at(-1).spaceBefore, false)
  assert.equal(parts[1].spaceBefore, true)
  assert.equal(parts[0].spaceBefore, false)
})

test('inserted and removed words are found anywhere in the sentence', () => {
  assert.equal(
    summary(diffSentences('Ich lerne Deutsch seit zwei Jahre', 'Ich lerne seit zwei Jahren Deutsch')),
    's:Ich s:lerne r:Deutsch s:seit s:zwei r:Jahre a:Jahren a:Deutsch',
  )
  assert.deepEqual(diffSentences('', ''), [])
  assert.equal(summary(diffSentences('Hallo', 'Hallo')), 's:Hallo')
})
