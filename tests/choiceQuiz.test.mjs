import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getChoiceOptions,
  getStudySetChoiceOptions,
} from '../src/choiceQuiz.ts'

const makeCard = (id, prompt, meaning, category = 'noun', tags = ['A1', category]) => ({
  id,
  prompt,
  meaning,
  category,
  tags,
  status: 'active',
})

const deck = [
  makeCard('target', 'die Wohnung', 'apartment'),
  makeCard('table', 'der Tisch', 'table'),
  makeCard('child', 'das Kind', 'child'),
  makeCard('book', 'das Buch', 'book'),
  makeCard('verb', 'gehen', 'to go', 'verb'),
  makeCard('other-level', 'das Haus', 'house', 'noun', ['A2', 'noun']),
  makeCard('same-meaning', 'das Appartement', 'apartment'),
]

test('choice quiz gives one correct answer and three distinct distractors', () => {
  const options = getChoiceOptions(deck[0], deck, 0)

  assert.equal(options.length, 4)
  assert.equal(options.filter((option) => option.correct).length, 1)
  assert.equal(options.find((option) => option.correct).cardId, 'target')
  assert.equal(new Set(options.map((option) => option.prompt.toLowerCase())).size, 4)
  assert.ok(!options.some((option) => option.cardId === 'same-meaning'))
})

test('choice order is deterministic for one question and varies by question index', () => {
  const first = getChoiceOptions(deck[0], deck, 0)
  const repeated = getChoiceOptions(deck[0], deck, 0)
  const nextQuestion = getChoiceOptions(deck[0], deck, 1)

  assert.deepEqual(first, repeated)
  assert.notDeepEqual(first.map((option) => option.cardId), nextQuestion.map((option) => option.cardId))
})

test('same-category, same-level words are preferred as distractors', () => {
  const options = getChoiceOptions(deck[0], deck, 2)

  assert.ok(options.some((option) => option.cardId === 'table'))
  assert.ok(options.some((option) => option.cardId === 'child'))
  assert.ok(options.some((option) => option.cardId === 'book'))
})

test('returns fewer choices when the deck has too few distinct alternatives', () => {
  const options = getChoiceOptions(deck[0], [deck[0], deck[1]], 0)

  assert.equal(options.length, 2)
})

test('fills a small study set with distinct options from the full deck', () => {
  const selection = getStudySetChoiceOptions(deck[0], [deck[0], deck[1]], deck, 0)

  assert.equal(selection.usedDeckFallback, true)
  assert.equal(selection.options.length, 4)
  assert.equal(selection.options.filter((option) => option.correct).length, 1)
  assert.ok(selection.options.some((option) => option.cardId === 'child'))
})

test('keeps all distractors within a set when it already has enough choices', () => {
  const scoped = deck.slice(0, 4)
  const selection = getStudySetChoiceOptions(deck[0], scoped, deck, 0)

  assert.equal(selection.usedDeckFallback, false)
  assert.ok(selection.options.every((option) => scoped.some((card) => card.id === option.cardId)))
})

test('uses the larger option set but remains honest when the full deck is still small', () => {
  const scoped = [deck[0], deck[1]]
  const smallDeck = [deck[0], deck[1], deck[2]]
  const selection = getStudySetChoiceOptions(deck[0], scoped, smallDeck, 0)

  assert.equal(selection.usedDeckFallback, true)
  assert.equal(selection.options.length, 3)
})

test('distractors stay visually distinct across multiple senses and unicode forms',()=>{
 const target=makeCard('t','das Haus','house')
 const options=getChoiceOptions(target,[target,makeCard('a','der Tisch','table'),makeCard('b','der Tisch','desk'),makeCard('c','das Buch','book'),makeCard('d','das Kind','child')],0)
 assert.equal(options.length,4)
 assert.equal(new Set(options.map(o=>o.prompt)).size,4)
})
test('overlapping meaning alternatives and explicit accepted answers cannot be wrong options',()=>{
 const target={...makeCard('t','die Wohnung','apartment'),acceptedAnswers:['das Quartier']}
 const options=getChoiceOptions(target,[target,makeCard('a','das Appartement','flat; apartment'),makeCard('b','das Quartier','lodging'),...deck.slice(1,4)],0)
 assert.ok(!options.some(o=>['a','b'].includes(o.cardId)))
 assert.equal(options.filter(o=>o.correct).length,1)
})
test('the real starter deck does not repeat ab for the schön question',async()=>{
 const {readFile}=await import('node:fs/promises')
 const pack=JSON.parse(await readFile(new URL('../src/data/german-starter-pack.json',import.meta.url),'utf8'))
 const cards=pack.cards.map(c=>makeCard(c.id,c.article?`${c.article} ${c.word}`:c.word,c.meaning,c.category,c.tags))
 const target=cards.find(c=>c.prompt==='schön'&&c.meaning==='beautifully')
 const options=getChoiceOptions(target,cards,0)
 assert.equal(new Set(options.map(o=>o.prompt)).size,options.length)
})
