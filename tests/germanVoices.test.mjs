import test from 'node:test'
import assert from 'node:assert/strict'
import { selectGermanVoice } from '../src/germanVoices.ts'
import { getRecording } from '../src/pronunciation.ts'
import { readFile } from 'node:fs/promises'
test('German speech prefers a local voice and never substitutes a different language',()=>{
 const remote={lang:'de-DE',localService:false},local={lang:'de-AT',localService:true}
 assert.equal(selectGermanVoice([remote,local]),local)
 assert.equal(selectGermanVoice([{lang:'en-US',localService:true}]),undefined)
 assert.equal(selectGermanVoice([]),undefined)
 assert.equal(selectGermanVoice([remote]),remote)
})
test('open pronunciation covers the measured starter set with per-recording attribution',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../src/data/german-pronunciation.json',import.meta.url),'utf8'))
 const starter=JSON.parse(await readFile(new URL('../src/data/german-starter-pack.json',import.meta.url),'utf8'))
 const cards=starter.cards.map(c=>({...c,prompt:c.article?`${c.article} ${c.word}`:c.word}))
 const covered=cards.filter(c=>getRecording(c,manifest.entries)).length
 assert.equal(covered,manifest.coverage.coveredCards)
 assert.equal(covered,cards.length)
 assert.equal(manifest.coverage.starterCards,cards.length)
 for(const entry of Object.values(manifest.entries)){
  assert.match(entry.url,/^https:\/\/upload.wikimedia.org\//)
  assert.match(entry.source,/^https:\/\/commons.wikimedia.org\/wiki\//)
  assert.match(entry.licenseUrl,/^https:\/\/creativecommons.org\//)
  assert.ok(entry.author.trim())
 }
 assert.ok(getRecording({category:'verb',prompt:'gehen'},manifest.entries))
 assert.equal(getRecording({category:'phrase',prompt:'unlisted new phrase'},manifest.entries),undefined)
})
