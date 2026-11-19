import assert from 'node:assert/strict'
import test from 'node:test'
import { isProductionAnswerCorrect } from '../src/productionQuiz.ts'

test('typed production accepts case, surrounding punctuation, and repeated whitespace differences', () => {
  assert.equal(isProductionAnswerCorrect('  DIE   Wohnung! ', 'die Wohnung'), true)
})

test('typed production requires the saved noun article and German spelling', () => {
  assert.equal(isProductionAnswerCorrect('Wohnung', 'die Wohnung'), false)
  assert.equal(isProductionAnswerCorrect('die Strasse', 'die Straße'), false)
})

test('typed production normalizes composed and decomposed German characters', () => {
  assert.equal(isProductionAnswerCorrect('die Mu\u0308tze', 'die Mütze'), true)
})

test('accepted answers require explicit keys rather than automatic synonym acceptance',async()=>{
 const {findProductionAlternative,validAcceptedAnswers,productionMismatch}=await import('../src/productionQuiz.ts')
 assert.equal(isProductionAnswerCorrect('das Appartement','die Wohnung',['das Appartement']),true)
 assert.equal(isProductionAnswerCorrect('der Appartement','die Wohnung',['das Appartement']),false)
 assert.equal(validAcceptedAnswers(['Appartement'],'noun'),false)
 assert.equal(validAcceptedAnswers(['das Appartement'],'noun'),true)
 assert.equal(validAcceptedAnswers(Array(11).fill('das Haus'),'noun'),false)
 assert.equal(productionMismatch('der Wohnung','die Wohnung'),'Check the article.')
 const target={id:'t',prompt:'die Wohnung',meaning:'apartment',category:'noun',status:'active'}
 const alternative={id:'a',prompt:'das Appartement',meaning:'flat; apartment',category:'noun',status:'active'}
 assert.equal(findProductionAlternative('DAS APPARTEMENT',target,[target,alternative])?.id,'a')
 assert.equal(findProductionAlternative('der Wohnung',target,[target,alternative]),undefined)
})
