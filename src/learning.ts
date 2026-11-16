import type { Card } from './deckImport'
import { scheduleReview, type Rating, type RecallField, type ReviewMode } from './scheduler.ts'

export const saveForLearning = (card: Card, at: Date): Card => ({
  ...card,
  learning: { saved: true, updatedAt: at.toISOString() },
})

export const reviewLearningCard = (
  card: Card,
  rating: Rating,
  at: Date,
  struggledWith: RecallField[] = [],
  mode: ReviewMode = 'recall',
  answerCorrect?: boolean,
): Card => ({
  ...scheduleReview(card, rating, at, struggledWith, mode, answerCorrect),
  ...(card.learning?.saved || card.lastReviewedAt === null
    ? { learning: { saved: false, updatedAt: at.toISOString() } }
    : {}),
})
