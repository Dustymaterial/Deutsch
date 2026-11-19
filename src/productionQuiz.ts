import { meaningsOverlap } from './quizMeaning.ts'
export const normalizeAnswer = (value: string) =>
  value
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(/\s+/g, ' ')
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')

export const isProductionAnswerCorrect = (answer: string, expected: string, acceptedAnswers: string[] = []) =>
  [expected, ...acceptedAnswers].some((value) => normalizeAnswer(answer) === normalizeAnswer(value))

export const validAcceptedAnswers = (value: unknown, category: string): value is string[] =>
  Array.isArray(value) && value.length <= 10 && value.every((answer) =>
    typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 200
    && (category !== 'noun' || /^(der|die|das)\s+\S/i.test(answer.trim())),
  )

type AnswerCard = { id: string; prompt: string; meaning: string; category: string; status: string }
export const findProductionAlternative = (answer: string, target: AnswerCard, cards: AnswerCard[]) =>
  cards.find((card) => card.id !== target.id && card.status === 'active' && card.category === target.category
    && meaningsOverlap(card.meaning, target.meaning) && normalizeAnswer(card.prompt) === normalizeAnswer(answer))

export const productionMismatch = (answer: string, expected: string) => {
  const typed = normalizeAnswer(answer)
  const saved = normalizeAnswer(expected)
  if (/^(der|die|das) /.test(saved) && typed.replace(/^(der|die|das) /, '') === saved.replace(/^(der|die|das) /, '')) return 'Check the article.'
  return 'Different from the saved answer.'
}
