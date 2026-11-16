import assert from 'node:assert/strict'
import test from 'node:test'
import { getSentenceWords } from '../src/sentenceWords.ts'

const example = 'Regelmäßige Bewegung und gesundes Essen sind sehr wichtig für die eigene Gesundheit.'
const translation = "Regular exercise and healthy food are very important for one's own health."

test('curated sentence words preserve the original text and map corresponding words', () => {
  const words = getSentenceWords(example, translation)
  assert.equal(words.german.map((part) => part.text).join(''), example)
  assert.equal(words.english.map((part) => part.text).join(''), translation)
  assert.equal(words.german.find((part) => part.text === 'Bewegung').match, 'Bewegung')
  assert.equal(words.english.find((part) => part.text === 'exercise').match, 'Bewegung')
  assert.equal(words.german.find((part) => part.text === 'die').match, undefined)
})

test('other or edited sentence pairs are not guessed', () => {
  assert.equal(getSentenceWords(example, 'A different translation.'), null)
  assert.equal(getSentenceWords('Ein anderes Beispiel.', translation), null)
})
