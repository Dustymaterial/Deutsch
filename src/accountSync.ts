import type { Card } from './deckImport'
import { resetReviewProgress, scheduleReview, type ReviewEvent } from './scheduler.ts'
import type { StudyPlan } from './studyPlan'
import { mergeWordActivity } from './activity.ts'

export type AccountProgress = {
  cards: Card[]
  studyPlan: StudyPlan
}

const reviewKey = (review: ReviewEvent, replayed: boolean) =>
  JSON.stringify([
    review.at,
    review.rating,
    ...(replayed ? [] : [review.intervalDays, review.easeFactor]),
    review.mode ?? (replayed ? 'recall' : ''),
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
  const learning = !local.learning ? remote.learning : !remote.learning ? local.learning
    : Date.parse(local.learning.updatedAt) >= Date.parse(remote.learning.updatedAt)
      ? local.learning : remote.learning
  const resetAt = [local.reviewResetAt, remote.reviewResetAt]
    .filter((value): value is string => value !== undefined)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  const firstReviewScheduledAt = [local.firstReviewScheduledAt, remote.firstReviewScheduledAt]
    .filter((value): value is string => value !== undefined &&
      (!resetAt || Date.parse(value) > Date.parse(resetAt)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
  const reviews = new Map<string, ReviewEvent>()
  for (const review of [...local.reviewHistory, ...remote.reviewHistory]) {
    reviews.set(reviewKey(review, Boolean(resetAt)), review)
  }
  if (resetAt && [local, remote].some((card) =>
    card.lastReviewedAt && Date.parse(card.lastReviewedAt) > Date.parse(resetAt) &&
    !card.reviewHistory.some((review) => review.at === card.lastReviewedAt),
  )) {
    throw new Error('Review progress could not be merged safely because a review is missing from its history.')
  }
  const reviewHistory = [...reviews.values()].filter(
    (review) => !resetAt || Date.parse(review.at) > Date.parse(resetAt),
  ).sort(
    (left, right) => Date.parse(left.at) - Date.parse(right.at),
  )

  const pluralSource = [local, remote].filter((card) => card.pluralUpdatedAt)
    .sort((a, b) => Date.parse(b.pluralUpdatedAt!) - Date.parse(a.pluralUpdatedAt!))[0]
  const merged: Card = {
    ...latest,
    ...(pluralSource ? { plural: pluralSource.plural, pluralUpdatedAt: pluralSource.pluralUpdatedAt } : {}),
    activity: mergeWordActivity(local, remote),
    firstReviewScheduledAt,
    ...(learning ? { learning } : {}),
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
  if (!resetAt) return merged

  const reset = resetReviewProgress(merged, new Date(resetAt))
  const replayed = reviewHistory.reduce(
    (card, review) => scheduleReview(
      card,
      review.rating,
      new Date(review.at),
      review.struggledWith,
      review.mode,
      review.answerCorrect,
    ),
    reset,
  )
  const updatedAt = Date.parse(local.updatedAt) >= Date.parse(remote.updatedAt)
    ? local.updatedAt : remote.updatedAt
  return { ...replayed, updatedAt }
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
