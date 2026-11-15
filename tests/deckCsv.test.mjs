import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDeckFile, parseVocabularyCsv } from '../src/deckImport.ts'

test('CSV supports UTF-8 words, quoted commas, escaped quotes and tags', () => {
  const csv = [
    'word,category,article,meaning,plural,example,translation,level,tags',
    'Wohnung,noun,die,apartment,die Wohnungen,"Die Wohnung ist hell, warm und ruhig.","The apartment is bright, warm, and quiet.",A1,home|housing',
    'verstehen,verb,,to understand,,"Er sagt: ""Ich verstehe dich."".",He says: "I understand you.",A2,communication',
  ].join('\r\n')

  const entries = parseVocabularyCsv(csv)

  assert.equal(entries.length, 2)
  assert.equal(entries[0].example, 'Die Wohnung ist hell, warm und ruhig.')
  assert.deepEqual(entries[0].tags, ['home', 'housing'])
  assert.equal(entries[1].example, 'Er sagt: "Ich verstehe dich.".')
})

test('CSV file imports create new review states', () => {
  const csv = [
    'word,category,article,meaning,plural,example,translation,level,tags',
    'Buch,noun,das,book,die Bücher,Das Buch ist neu.,The book is new.,A1,reading',
  ].join('\n')

  const result = parseDeckFile(csv, 'my-words.CSV', new Date('2026-01-01T00:00:00Z'))

  assert.equal(result.kind, 'vocabulary')
  assert.equal(result.cards[0].prompt, 'das Buch')
  assert.equal(result.cards[0].lastReviewedAt, null)
})

test('CSV reports missing headers, malformed rows and unclosed quotes', () => {
  assert.throws(
    () => parseVocabularyCsv('word,meaning\nHaus,house'),
    /missing required columns/,
  )
  assert.throws(
    () => parseVocabularyCsv('word,category,article,meaning,example\nHaus,noun,das,house'),
    /has 4 cells; expected 5/,
  )
  assert.throws(
    () => parseVocabularyCsv('word,category,article,meaning,example\nHaus,noun,das,house,"Das Haus'),
    /unfinished quoted field/,
  )
})
