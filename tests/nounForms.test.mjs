import test from 'node:test'
import assert from 'node:assert/strict'
import { getNounFormInfo } from '../src/nounForms.ts'
const noun=(prompt,meaning,article='die',extra={})=>({prompt,meaning,article,category:'noun',...extra})
test('plural supplements respect sense and never replace a recorded form',()=>{
 assert.equal(getNounFormInfo(noun('die Bank','bench')).plural,'die Bänke')
 assert.equal(getNounFormInfo(noun('die Bank','bank')).plural,'die Banken')
 assert.equal(getNounFormInfo(noun('das Wort','word','das')).plural,'die Wörter')
 assert.equal(getNounFormInfo(noun('der Schuh','shoe','der')).plural,'die Schuhe')
 assert.equal(getNounFormInfo(noun('der Schuh','custom meaning','der')).status,'unknown')
 assert.equal(getNounFormInfo(noun('die Bank','bank','die',{plural:'my recorded form'})).plural,'my recorded form')
})
test('missing data stays distinct from verified usual-number states',()=>{
 assert.equal(getNounFormInfo(noun('die Gesundheit','health')).status,'usually-singular')
 assert.equal(getNounFormInfo(noun('die Nachrichten','news')).status,'usually-plural')
 assert.equal(getNounFormInfo(noun('der Bau','construction','der')).status,'unknown')
 assert.equal(getNounFormInfo({category:'verb',prompt:'gehen',meaning:'go'}),null)
})
