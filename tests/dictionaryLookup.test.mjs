import assert from 'node:assert/strict'
import test from 'node:test'
import { addReason, lookupDictionary, parseDictionary } from '../src/dictionaryLookup.ts'

const dictionary = parseDictionary({
  format: 'deutsch-dictionary',
  version: 1,
  source: 'test',
  sourceUrl: 'https://example.test',
  license: 'CC BY-SA 4.0',
  lemmas: [
    ['gehen', 'verb', 'walk; go', '', '', 'Ich gehe zur Schule.', 'I go to school.', 'A1'],
    ['Haus', 'noun', 'house', 'das', 'Häuser', 'Das Haus ist groß.', 'The house is big.', 'A1'],
    ['haus', 'verb', 'dwell', '', '', '', '', 'C1'],
  ],
  forms: { gehen: 0, ging: 0, gegangen: 0, haus: [1, 2], häuser: 1 },
})

test('inflected forms resolve to their headword and say which form was tapped', () => {
  const [entry] = lookupDictionary(dictionary, 'Ging')
  assert.equal(entry.prompt, 'gehen')
  assert.equal(entry.meaning, 'walk; go')
  assert.equal(entry.form, 'Ging')
  assert.equal(entry.source, 'dictionary')
  assert.equal(lookupDictionary(dictionary, 'gehen')[0].form, undefined)
})

test('nouns carry their article and plural, and homographs keep their order', () => {
  const entries = lookupDictionary(dictionary, 'HÄUSER')
  assert.equal(entries[0].prompt, 'das Haus')
  assert.equal(entries[0].plural, 'die Häuser')
  assert.deepEqual(lookupDictionary(dictionary, 'Haus').map((entry) => entry.category), ['noun', 'verb'])
  assert.deepEqual(lookupDictionary(dictionary, 'haus').map((entry) => entry.category), ['verb', 'noun'])
  assert.equal(lookupDictionary(dictionary, 'haus')[0].example, undefined)
})

test('unknown words and malformed files are rejected cleanly', () => {
  assert.deepEqual(lookupDictionary(dictionary, 'Spaziergang'), [])
  assert.deepEqual(lookupDictionary(dictionary, 'constructor'), [])
  assert.throws(() => parseDictionary({ format: 'other' }), /expected format/)
  assert.throws(() => parseDictionary(null), /expected format/)
})

test('only complete nouns, verbs, adjectives, adverbs and numbers can be added', () => {
  const [verb] = lookupDictionary(dictionary, 'gehen')
  assert.equal(addReason(verb), null)
  assert.match(addReason({ ...verb, category: 'preposition' }), /Only nouns/)
  assert.match(addReason({ ...verb, example: undefined }), /No example/)
  assert.match(addReason({ ...verb, category: 'noun' }), /no known article/)
  assert.equal(addReason({ ...verb, source: 'starter', category: 'preposition' }), null)
})
