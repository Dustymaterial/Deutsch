import type { Card } from './deckImport'
import type { ReviewEvent } from './scheduler'
import type { StudyPlan } from './studyPlan'

export type AccountProgress = {
  cards: Card[]
  studyPlan: StudyPlan
}

const reviewKey = (review: ReviewEvent) =>
  JSON.stringify([
    review.at,
    review.rating,
    review.intervalDays,
    review.easeFactor,
    review.mode ?? '',
    review.answerCorrect ?? null,
    review.struggledWith ?? [],
  ])

const cardIsNewer = (left: Card, right: Card) => {
  if (left.lastReviewedAt && !right.lastReviewedAt) return true
  if (right.lastReviewedAt && !left.lastReviewedAt) return false
  const leftReviewedAt = left.lastReviewedAt ? Date.parse(left.lastReviewedAt) : 0
  const rightReviewedAt = right.lastReviewedAt ? Date.parse(right.lastReviewedAt) : 0
  if (leftReviewedAt !== rightReviewedAt) return leftReviewedAt > rightReviewedAt
  return Date.parse(left.updatedAt) >= Date.parse(right.updatedAt)
}

const mergeCard = (local: Card, remote: Card): Card => {
  const latest = cardIsNewer(local, remote) ? local : remote
  const reviews = new Map<string, ReviewEvent>()
  for (const review of [...local.reviewHistory, ...remote.reviewHistory]) {
    reviews.set(reviewKey(review), review)
  }
  const reviewHistory = [...reviews.values()].sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  )

  return {
    ...latest,
    tags: [...new Set([...local.tags, ...remote.tags])],
    status: local.status === 'archived' || remote.status === 'archived' ? 'archived' : latest.status,
    reviewHistory,
    correctCount: Math.max(
      local.correctCount,
      remote.correctCount,
      reviewHistory.filter((review) => review.answerCorrect ?? review.rating !== 'again').length,
    ),
    incorrectCount: Math.max(
      local.incorrectCount,
      remote.incorrectCount,
      reviewHistory.filter((review) => review.answerCorrect === false || review.rating === 'again').length,
    ),
    lapses: Math.max(
      local.lapses,
      remote.lapses,
      reviewHistory.filter((review) => review.rating === 'again').length,
    ),
  }
}

export const mergeAccountCards = (local: Card[], remote: Card[]) => {
  const cardsById = new Map(remote.map((card) => [card.id, card]))
  for (const card of local) {
    const saved = cardsById.get(card.id)
    cardsById.set(card.id, saved ? mergeCard(card, saved) : card)
  }
  return [...cardsById.values()]
}

export const mergeAccountProgress = (
  local: AccountProgress,
  remote: AccountProgress,
  preferLocalPlan: boolean,
): AccountProgress => ({
  cards: mergeAccountCards(local.cards, remote.cards),
  studyPlan: preferLocalPlan ? local.studyPlan : remote.studyPlan,
})
