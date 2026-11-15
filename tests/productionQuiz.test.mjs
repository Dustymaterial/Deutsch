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
