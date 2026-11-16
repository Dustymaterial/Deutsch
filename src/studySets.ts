import type { Card } from './deckImport'
import { getNewCardQuotaRemaining } from './scheduler.ts'

const CARD_METADATA_TAGS = new Set([
  'a1',
  'a2',
  'noun',
  'verb',
  'adjective',
  'adverb',
  'numeral',
  'phrase',
])

export type StudySetProgress = {
  recall: { remembered: number; again: number; total: number }
  choice: { correct: number; answered: number }
  production: { correct: number; answered: number }
}

export const getStudySetTags = (cards: Card[]) => {
  const tags = new Map<string, string>()
  for (const card of cards) {
    if (card.status !== 'active') continue
    for (const tag of card.tags) {
      const trimmed = tag.trim()
      if (!trimmed || CARD_METADATA_TAGS.has(trimmed.toLocaleLowerCase('en'))) continue
      const key = trimmed.toLocaleLowerCase('en')
      if (!tags.has(key)) tags.set(key, trimmed)
    }
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b))
}

export const getCardsForStudySet = (cards: Card[], tag: string) =>
  cards.filter(
    (card) => card.status === 'active' && (!tag || card.tags.includes(tag)),
  )

export const getReviewedWords = (cards: Card[], query: string) => {
  const search = query.trim().toLocaleLowerCase()
  return cards
    .filter((card) =>
      card.status === 'active' && card.lastReviewedAt !== null &&
      (card.prompt.toLocaleLowerCase().includes(search) ||
        card.meaning.toLocaleLowerCase().includes(search)),
    )
    .sort((left, right) => left.prompt.localeCompare(right.prompt, 'de'))
}

export const getStudySetNewCardLimit = (
  allCards: Card[],
  scopedCards: Card[],
  now: Date,
  dailyLimit: number,
) => {
  const unseenInSet = scopedCards.filter((card) => card.lastReviewedAt === null).length
  const remainingDailyQuota = getNewCardQuotaRemaining(allCards, now, dailyLimit)
  return Math.min(unseenInSet, remainingDailyQuota)
}

export const getStudySetProgress = (cards: Card[]): StudySetProgress => {
  const progress: StudySetProgress = {
    recall: { remembered: 0, again: 0, total: 0 },
    choice: { correct: 0, answered: 0 },
    production: { correct: 0, answered: 0 },
  }

  for (const card of cards) {
    if (card.status !== 'active') continue

    for (const review of card.reviewHistory) {
      if (review.mode === undefined || review.mode === 'recall') {
        progress.recall.total += 1
        if (review.rating === 'again') progress.recall.again += 1
        else progress.recall.remembered += 1
      } else if (
        (review.mode === 'choice' || review.mode === 'production') &&
        typeof review.answerCorrect === 'boolean'
      ) {
        const modeProgress = progress[review.mode]
        modeProgress.answered += 1
        if (review.answerCorrect) modeProgress.correct += 1
      }
    }
  }

  return progress
}
