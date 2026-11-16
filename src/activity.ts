import type { Card } from './deckImport'

export type WordActivity = { added: string[]; reviewed: string[] }
export type ActivityKind = keyof WordActivity
export type DayActivity = { added: number; reviewed: number; total: number }

export const activityDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const isActivityDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export const isWordActivity = (value: unknown): value is WordActivity => {
  if (!value || typeof value !== 'object') return false
  const activity = value as Partial<WordActivity>
  return [activity.added, activity.reviewed].every(
    (days) => Array.isArray(days) && days.every(isActivityDay),
  )
}

const dayFromTimestamp = (timestamp: string | undefined) => {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? activityDayKey(date) : null
}

export const activityForCard = (card: Card): WordActivity => {
  const added = new Set(card.activity?.added ?? [])
  const reviewed = new Set(card.activity?.reviewed ?? [])
  if (!card.activity) {
    const introduced = dayFromTimestamp(card.firstReviewScheduledAt)
    if (introduced) added.add(introduced)
    for (const review of card.reviewHistory) {
      const day = dayFromTimestamp(review.at)
      if (day) reviewed.add(day)
    }
  }
  return { added: [...added].sort(), reviewed: [...reviewed].sort() }
}

export const mergeWordActivity = (left: Card, right: Card): WordActivity => {
  const a = activityForCard(left)
  const b = activityForCard(right)
  return {
    added: [...new Set([...a.added, ...b.added])].sort(),
    reviewed: [...new Set([...a.reviewed, ...b.reviewed])].sort(),
  }
}

export const recordWordActivity = (card: Card, kind: ActivityKind, at: Date): Card => {
  const activity = activityForCard(card)
  const day = activityDayKey(at)
  if (!activity[kind].includes(day)) activity[kind].push(day)
  return { ...card, activity }
}

export const summarizeActivity = (cards: Card[]): Map<string, DayActivity> => {
  const days = new Map<string, DayActivity>()
  for (const card of cards) {
    const activity = activityForCard(card)
    for (const day of new Set([...activity.added, ...activity.reviewed])) {
      const current = days.get(day) ?? { added: 0, reviewed: 0, total: 0 }
      current.total += 1
      if (activity.added.includes(day)) current.added += 1
      if (activity.reviewed.includes(day)) current.reviewed += 1
      days.set(day, current)
    }
  }
  return days
}

export const activityDates = (today: Date, count: number): Date[] => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  date.setDate(date.getDate() - count + 1)
  return Array.from({ length: count }, () => {
    const result = new Date(date)
    date.setDate(date.getDate() + 1)
    return result
  })
}
