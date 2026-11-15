import type { Card } from './deckImport'

export type ChoiceOption = {
  cardId: string
  prompt: string
  correct: boolean
}

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

const normalize = (value: string) =>
  value.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ')

export const getChoiceOptions = (
  target: Card,
  cards: Card[],
  sessionQuestion: number,
): ChoiceOption[] => {
  const targetMeaning = normalize(target.meaning)
  const targetPrompt = normalize(target.prompt)
  const targetLevel = target.tags.find((tag) => /^A[12]$/.test(tag))
  const candidates = cards.filter(
    (card) =>
      card.status === 'active' &&
      card.id !== target.id &&
      normalize(card.meaning) !== targetMeaning &&
      normalize(card.prompt) !== targetPrompt,
  )

  const preferred = candidates.filter(
    (card) =>
      card.category === target.category &&
      (!targetLevel || card.tags.includes(targetLevel)),
  )
  const sameCategory = candidates.filter(
    (card) => card.category === target.category && !preferred.includes(card),
  )
  const otherCards = candidates.filter(
    (card) => card.category !== target.category,
  )
  const ranked = (group: Card[]) =>
    group.sort(
      (a, b) =>
        hash(`${target.id}:${sessionQuestion}:${a.id}`) -
        hash(`${target.id}:${sessionQuestion}:${b.id}`),
    )
  const distractors = [...ranked(preferred), ...ranked(sameCategory), ...ranked(otherCards)].slice(0, 3)
  const options = [
    { cardId: target.id, prompt: target.prompt, correct: true },
    ...distractors.map((card) => ({
      cardId: card.id,
      prompt: card.prompt,
      correct: false,
    })),
  ]

  return options.sort(
    (a, b) =>
      hash(`${target.id}:${sessionQuestion}:position:${a.cardId}`) -
      hash(`${target.id}:${sessionQuestion}:position:${b.cardId}`),
  )
}

export const getStudySetChoiceOptions = (
  target: Card,
  scopedCards: Card[],
  allCards: Card[],
  sessionQuestion: number,
) => {
  const scopedOptions = getChoiceOptions(target, scopedCards, sessionQuestion)
  if (scopedOptions.length === 4) {
    return { options: scopedOptions, usedDeckFallback: false }
  }

  const deckOptions = getChoiceOptions(target, allCards, sessionQuestion)
  return deckOptions.length > scopedOptions.length
    ? { options: deckOptions, usedDeckFallback: true }
    : { options: scopedOptions, usedDeckFallback: false }
}
