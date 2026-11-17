import assert from 'node:assert/strict'
import test from 'node:test'
import { addReason, lookupDictionary, lookupEnglish, needsExample, parseDictionary, preferredLanguage } from '../src/dictionaryLookup.ts'

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
  assert.equal(addReason({ ...verb, example: undefined }), null)
  assert.equal(needsExample({ ...verb, example: undefined }), true)
  assert.equal(needsExample(verb), false)
  assert.match(addReason({ ...verb, category: 'noun' }), /no known article/)
  assert.equal(addReason({ ...verb, source: 'starter', category: 'preposition' }), null)
})

test('English words find German words by their meaning, best gloss and most frequent first', () => {
  const english = parseDictionary({
    format: 'deutsch-dictionary', version: 1, source: 't', sourceUrl: 'u', license: 'l',
    lemmas: [
      ['Heim', 'noun', 'home; institution; residence', 'das', 'Heime', 'Das Heim ist neu.', 'The home is new.', 'B1'],
      ['Haus', 'noun', 'house; home; building', 'das', 'Häuser', 'Das Haus ist groß.', 'The house is big.', 'A1'],
      ['lernen', 'verb', 'to learn; to study', '', '', 'Ich lerne.', 'I learn.', 'A1'],
      ['Spaß', 'noun', 'fun (in general); joke', 'der', '', 'Das macht Spaß.', 'That is fun.', 'A1'],
    ],
    forms: {},
  })
  assert.deepEqual(lookupEnglish(english, 'home').map((entry) => entry.prompt), ['das Heim', 'das Haus'])
  assert.equal(lookupEnglish(english, 'home')[0].via, 'home')
  assert.deepEqual(lookupEnglish(english, 'House').map((entry) => entry.prompt), ['das Haus'])
  assert.deepEqual(lookupEnglish(english, 'learning').map((entry) => entry.prompt), ['lernen'])
  assert.deepEqual(lookupEnglish(english, 'learned').map((entry) => entry.prompt), ['lernen'])
  assert.deepEqual(lookupEnglish(english, 'fun').map((entry) => entry.prompt), ['der Spaß'])
  assert.deepEqual(lookupEnglish(english, 'houses').map((entry) => entry.prompt), ['das Haus'])
  assert.deepEqual(lookupEnglish(english, 'nonsense'), [])
})

test('the more common reading of a tapped word is shown first', () => {
  const entry = (index, prompt) => ({ id: `dictionary-${index}`, source: 'dictionary', prompt, meaning: 'm', category: 'noun' })
  const german = [entry(18000, 'der House')]
  const english = [entry(250, 'das Haus')]
  assert.equal(preferredLanguage(german, english), 'en')
  assert.equal(preferredLanguage([entry(300, 'das Gift')], [entry(900, 'das Geschenk')]), 'de')
  assert.equal(preferredLanguage([], english), 'en')
  assert.equal(preferredLanguage(german, []), 'de')
  assert.equal(preferredLanguage([], []), null)
  assert.equal(preferredLanguage([{ ...german[0], source: 'deck', id: 'x' }], english), 'de')
})
