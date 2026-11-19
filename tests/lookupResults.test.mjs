import test from 'node:test'
import assert from 'node:assert/strict'
import { germanLookup } from '../src/lookupResults.ts'
import { indexWords, findWords } from '../src/wordLookup.ts'

const entry = (id, prompt, meaning, extra = {}) => ({ id, prompt, meaning, source:'deck', category:'verb', ...extra })
const dictionary = {
  format:'deutsch-dictionary', version:1, source:'test', sourceUrl:'test', license:'test',
  lemmas:[['gehen','verb','go','','','','','']], forms:{gehen:0,ging:0},
}
test('lookup retains distinct personal senses and their examples', () => {
  const own = [entry('bench','die Bank','bench',{category:'noun',example:'Ich sitze auf der Bank.',translation:'I sit on the bench.'}),entry('bank','die Bank','bank',{category:'noun'})]
  assert.equal(findWords('Bank',indexWords(own)).length,2)
  const found = germanLookup('Bank',own,[],dictionary)
  assert.deepEqual(found.map(e=>e.meaning),['bench','bank'])
  assert.equal(found[0].example,own[0].example)
  assert.equal(found[0].translation,own[0].translation)
})
test('verified dictionary forms resolve to personal senses before generic entries', () => {
  const own=[entry('mine','gehen','attend my class',{example:'Ich gehe zum Kurs.'})]
  const found=germanLookup('ging',own,[],dictionary)
  assert.equal(found[0].id,'mine')
  assert.equal(found[0].form,'ging')
  assert.equal(found[0].example,own[0].example)
  assert.equal(found.at(-1).source,'dictionary')
  assert.deepEqual(germanLookup('unknown',own,[],dictionary),[])
})
test('homographs of different categories do not inherit an unrelated lemma mapping', () => {
  const own=[entry('noun','das Gehen','walking',{category:'noun'})]
  const found=germanLookup('ging',own,[],dictionary)
  assert.equal(found.length,1)
  assert.equal(found[0].source,'dictionary')
})
test('personal lookup works without downloading a dictionary and favours personal duplicates', () => {
  const mine=entry('mine','gehen','go')
  const starter=entry('starter','gehen','go',{source:'starter'})
  assert.deepEqual(germanLookup('gehen',[mine],[starter],null),[mine])
})

test('bundled dictionary covers verified contractions and required inflected examples', async () => {
  const { readFile } = await import('node:fs/promises')
  const dictionary = JSON.parse(await readFile(new URL('../src/data/german-dictionary.json',import.meta.url),'utf8'))
  for (const word of ['zur','zum','im','beim','viele','Zahnschmerzen']) {
    assert.ok(germanLookup(word,[],[],dictionary).length,word)
  }
  assert.ok(dictionary.coverage.dictionaryMatches >= 4472)
  assert.equal(dictionary.coverage.exampleTokens,4651)
  assert.ok(dictionary.coverage.missing.includes('behandlungszimmer'))
})
