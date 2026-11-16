export type Rating = 'again' | 'hard' | 'good' | 'easy'
export type RecallField = 'article' | 'plural' | 'meaning' | 'context'
export type ReviewMode = 'recall' | 'choice' | 'production'

export type ReviewEvent = {
  at: string
  rating: Rating
  intervalDays: number
  easeFactor: number
  struggledWith?: RecallField[]
  mode?: ReviewMode
  answerCorrect?: boolean
}

export type ReviewState = {
  dueAt: string
  intervalDays: number
  repetitions: number
  easeFactor: number
  lapses: number
  lastReviewedAt: string | null
  lastRating: Rating | null
  correctCount: number
  incorrectCount: number
  reviewHistory: ReviewEvent[]
  updatedAt: string
  reviewResetAt?: string
}

export type SchedulableCard = ReviewState & {
  id: string
  prompt: string
  category?: string
  article?: string
  plural?: string
  createdAt?: string
  status: 'active' | 'archived'
}

export type WeakPattern = {
  field: RecallField
  observations: number
  flaggedReviews: number
  affectedCards: number
}

export const DEFAULT_NEW_CARDS_PER_SESSION = 5
export const MAX_REVIEWS_PER_SESSION = 30

export const resetReviewProgress = <T extends SchedulableCard>(card: T, now: Date): T => ({
  ...card,
  dueAt: now.toISOString(),
  intervalDays: 0,
  repetitions: 0,
  easeFactor: 2.5,
  lapses: 0,
  lastReviewedAt: null,
  lastRating: null,
  correctCount: 0,
  incorrectCount: 0,
  reviewHistory: [],
  reviewResetAt: now.toISOString(),
  updatedAt: now.toISOString(),
})

export const getInitialStudyMode = <T extends SchedulableCard>(
  cards: T[],
  now: Date,
): 'learn' | 'recall' => {
  const active = cards.filter((card) => card.status === 'active')
  const hasDueReview = active.some(
    (card) => card.lastReviewedAt !== null && new Date(card.dueAt).getTime() <= now.getTime(),
  )
  return !hasDueReview && active.some((card) => card.lastReviewedAt === null)
    ? 'learn'
    : 'recall'
}

const addDays = (date: Date, days: number) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const addMinutes = (date: Date, minutes: number) => {
  const next = new Date(date)
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

export const scheduleReview = <T extends SchedulableCard>(
  card: T,
  rating: Rating,
  now: Date,
  struggledWith: RecallField[] = [],
  mode: ReviewMode = 'recall',
  answerCorrect?: boolean,
): T => {
  const nextCard = { ...card }
  const previousEase = nextCard.easeFactor
  if (nextCard.reviewResetAt && now.getTime() <= Date.parse(nextCard.reviewResetAt)) {
    now = new Date(Date.parse(nextCard.reviewResetAt) + 1)
  }
  const timestamp = now.toISOString()

  switch (rating) {
    case 'again':
      nextCard.repetitions = 0
      nextCard.lapses += 1
      nextCard.incorrectCount += 1
      nextCard.intervalDays = 0
      nextCard.easeFactor = Math.max(1.3, previousEase - 0.2)
      nextCard.dueAt = addMinutes(now, 10).toISOString()
      break
    case 'hard':
      nextCard.intervalDays =
        nextCard.repetitions === 0
          ? 1
          : Math.max(1, Math.round(nextCard.intervalDays * 1.2))
      nextCard.easeFactor = Math.max(1.3, previousEase - 0.1)
      nextCard.repetitions += 1
      nextCard.correctCount += 1
      nextCard.dueAt = addDays(now, nextCard.intervalDays).toISOString()
      break
    case 'good':
      nextCard.intervalDays =
        nextCard.repetitions === 0
          ? 1
          : Math.max(1, Math.round(nextCard.intervalDays * nextCard.easeFactor))
      nextCard.easeFactor = Math.min(3, previousEase + 0.05)
      nextCard.repetitions += 1
      nextCard.correctCount += 1
      nextCard.dueAt = addDays(now, nextCard.intervalDays).toISOString()
      break
    case 'easy':
      nextCard.intervalDays =
        nextCard.repetitions === 0
          ? 3
          : Math.max(2, Math.round(nextCard.intervalDays * nextCard.easeFactor * 1.4))
      nextCard.easeFactor = Math.min(3, previousEase + 0.1)
      nextCard.repetitions += 1
      nextCard.correctCount += 1
      nextCard.dueAt = addDays(now, nextCard.intervalDays).toISOString()
      break
  }

  nextCard.lastReviewedAt = timestamp
  nextCard.lastRating = rating
  nextCard.updatedAt = timestamp
  nextCard.reviewHistory = [
    ...nextCard.reviewHistory,
    {
      at: timestamp,
      rating,
      intervalDays: nextCard.intervalDays,
      easeFactor: nextCard.easeFactor,
      struggledWith,
      mode,
      ...(answerCorrect === undefined ? {} : { answerCorrect }),
    },
  ]

  return nextCard
}

export const detectWeakPattern = <T extends SchedulableCard>(cards: T[]): WeakPattern | null => {
  const active = cards.filter((card) => card.status === 'active')
  const candidates: WeakPattern[] = []

  for (const field of ['article', 'plural', 'meaning', 'context'] as const) {
    const applicableCards = active.filter((card) => {
      if (field === 'article') return card.category === 'noun' && Boolean(card.article)
      if (field === 'plural') return card.category === 'noun' && Boolean(card.plural)
      return true
    })
    const reviews = applicableCards.flatMap((card) =>
      card.reviewHistory.map((review) => ({ cardId: card.id, review })),
    )
    const flagged = reviews.filter(({ review }) => review.struggledWith?.includes(field))
    const affectedCards = new Set(flagged.map(({ cardId }) => cardId)).size

    if (
      reviews.length >= 5 &&
      flagged.length >= 3 &&
      affectedCards >= 2 &&
      flagged.length / reviews.length >= 0.35
    ) {
      candidates.push({
        field,
        observations: reviews.length,
        flaggedReviews: flagged.length,
        affectedCards,
      })
    }
  }

  return candidates.sort((a, b) => {
    const rateDifference =
      b.flaggedReviews / b.observations - a.flaggedReviews / a.observations
    if (rateDifference !== 0) return rateDifference
    return b.flaggedReviews - a.flaggedReviews
  })[0] ?? null
}

export const getSessionCardIds = <T extends SchedulableCard>(
  cards: T[],
  now: Date,
  newCardLimit = DEFAULT_NEW_CARDS_PER_SESSION,
  reviewLimit = MAX_REVIEWS_PER_SESSION,
): string[] => {
  const active = cards.filter((card) => card.status === 'active')
  const due = active
    .filter(
      (card) =>
        card.lastReviewedAt !== null && new Date(card.dueAt).getTime() <= now.getTime(),
    )
    .sort((a, b) => {
      const dueDifference = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      if (dueDifference !== 0) return dueDifference
      if (a.lapses !== b.lapses) return b.lapses - a.lapses
      return new Date(a.lastReviewedAt ?? 0).getTime() -
        new Date(b.lastReviewedAt ?? 0).getTime()
    })
    .slice(0, reviewLimit)
  const remainingSlots = Math.max(0, reviewLimit - due.length)
  const newCards = active
    .filter((card) => card.lastReviewedAt === null)
    .sort((a, b) => {
      const aCreated = new Date(a.createdAt ?? a.dueAt).getTime()
      const bCreated = new Date(b.createdAt ?? b.dueAt).getTime()
      if (aCreated !== bCreated) return bCreated - aCreated
      return a.prompt.localeCompare(b.prompt)
    })
    .slice(0, Math.min(newCardLimit, remainingSlots))

  return [...due, ...newCards].map((card) => card.id)
}

export const getLocalDayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

export const getCardsIntroducedToday = <T extends SchedulableCard>(
  cards: T[],
  now: Date,
): T[] => {
  const today = getLocalDayKey(now)
  return cards.filter((card) => {
    const firstReview = card.reviewHistory[0]
    return (
      card.status === 'active' &&
      firstReview !== undefined &&
      getLocalDayKey(new Date(firstReview.at)) === today
    )
  })
}

export const getNewCardQuotaRemaining = <T extends SchedulableCard>(
  cards: T[],
  now: Date,
  dailyLimit: number,
): number => {
  const introducedToday = cards.filter((card) => {
    const firstReview = card.reviewHistory[0]
    return firstReview && getLocalDayKey(new Date(firstReview.at)) === getLocalDayKey(now)
  }).length
  const unseenCount = cards.filter(
    (card) => card.status === 'active' && card.lastReviewedAt === null,
  ).length

  return Math.min(unseenCount, Math.max(0, dailyLimit - introducedToday))
}
