import assert from 'node:assert/strict'
import test from 'node:test'
import { findMatch, foldText, matchSnippet } from '../src/messageSearch.ts'

test('matching ignores case and accents and maps back to the original text', () => {
  assert.equal(foldText('Über Straße'), 'uber straße')
  assert.deepEqual(findMatch('Ich gehe über die Brücke', 'UBER'), [9, 13])
  assert.deepEqual(findMatch('Ich gehe u\u0308ber die Brücke', 'über'), [9, 14])
  assert.equal(findMatch('Guten Morgen', 'abend'), null)
  assert.equal(findMatch('Guten Morgen', '   '), null)
})

test('snippets come from the field that matched and trim long text around the match', () => {
  const card = { prompt: 'die Galerie', meaning: 'gallery', example: 'Wir besuchen die Galerie.' }
  assert.deepEqual(matchSnippet({ text: 'Shared a word: die Galerie', card }, 'gallery'), {
    before: '', match: 'gallery', after: '',
  })
  assert.equal(matchSnippet({ text: 'Shared a word: die Galerie', card }, 'shared'), null)

  const long = `${'a'.repeat(80)} Brücke ${'b'.repeat(80)}`
  const snippet = matchSnippet({ text: long }, 'brucke')
  assert.equal(snippet?.match, 'Brücke')
  assert.ok(snippet?.before.startsWith('…') && snippet.after.endsWith('…'))
})

test('corrections are searchable alongside the original message', () => {
  const message = { text: 'Ich habe gestern gehen', correction: { text: 'Ich bin gestern gegangen', note: 'Perfekt mit sein' } }
  assert.equal(matchSnippet(message, 'gegangen')?.match, 'gegangen')
  assert.equal(matchSnippet(message, 'perfekt')?.match, 'Perfekt')
})
