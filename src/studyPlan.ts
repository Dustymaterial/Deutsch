export type CurrentLevel = 'unknown' | 'A0' | 'A1' | 'A2' | 'B1'
export type TargetLevel = 'A1' | 'A2' | 'B1' | 'B2'
export type StudyIntensity = 'steady' | 'focused' | 'intensive'

export type StudyPlan = {
  currentLevel: CurrentLevel
  targetLevel: TargetLevel
  targetDate: string
  intensity: StudyIntensity
}

export const INTENSITY_SETTINGS: Record<
  StudyIntensity,
  { label: string; newCardsPerDay: number; reviewLimit: number; minutesPerDay: number }
> = {
  steady: {
    label: 'Steady',
    newCardsPerDay: 5,
    reviewLimit: 30,
    minutesPerDay: 15,
  },
  focused: {
    label: 'Focused',
    newCardsPerDay: 10,
    reviewLimit: 50,
    minutesPerDay: 30,
  },
  intensive: {
    label: 'Intensive',
    newCardsPerDay: 15,
    reviewLimit: 80,
    minutesPerDay: 50,
  },
}

const LEVEL_ORDER = ['A0', 'A1', 'A2', 'B1', 'B2'] as const
const GUIDED_HOURS: Partial<Record<TargetLevel, { min: number; max: number }>> = {
  A1: { min: 60, max: 150 },
  A2: { min: 150, max: 260 },
  B1: { min: 260, max: 490 },
  B2: { min: 450, max: 600 },
}
const DAY_MS = 24 * 60 * 60 * 1000

const localDateString = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const createDefaultStudyPlan = (now = new Date()): StudyPlan => {
  const targetDate = new Date(now)
  targetDate.setDate(targetDate.getDate() + 90)
  return {
    currentLevel: 'unknown',
    targetLevel: 'B1',
    targetDate: localDateString(targetDate),
    intensity: 'intensive',
  }
}

export const isStudyPlan = (value: unknown): value is StudyPlan => {
  if (!value || typeof value !== 'object') return false
  const plan = value as Partial<StudyPlan>
  const dateParts =
    typeof plan.targetDate === 'string'
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(plan.targetDate)
      : null
  const parsedDate = dateParts
    ? new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]))
    : null
  const validDate = Boolean(
    dateParts &&
      parsedDate &&
      parsedDate.getFullYear() === Number(dateParts[1]) &&
      parsedDate.getMonth() === Number(dateParts[2]) - 1 &&
      parsedDate.getDate() === Number(dateParts[3]),
  )

  return (
    (plan.currentLevel === 'unknown' ||
      plan.currentLevel === 'A0' ||
      plan.currentLevel === 'A1' ||
      plan.currentLevel === 'A2' ||
      plan.currentLevel === 'B1') &&
    (plan.targetLevel === 'A1' ||
      plan.targetLevel === 'A2' ||
      plan.targetLevel === 'B1' ||
      plan.targetLevel === 'B2') &&
    validDate &&
    (plan.intensity === 'steady' ||
      plan.intensity === 'focused' ||
      plan.intensity === 'intensive')
  )
}

export type GoalPaceEstimate = {
  daysRemaining: number
  guidedHours: { min: number; max: number } | null
  guidedHoursPerDay: { min: number; max: number } | null
}

export const estimateGoalPace = (plan: StudyPlan, now = new Date()): GoalPaceEstimate => {
  const targetDate = new Date(`${plan.targetDate}T00:00:00`)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysRemaining = Math.max(0, Math.ceil((targetDate.getTime() - today.getTime()) / DAY_MS))

  if (plan.currentLevel === 'unknown') {
    return { daysRemaining, guidedHours: null, guidedHoursPerDay: null }
  }

  const currentIndex = LEVEL_ORDER.indexOf(plan.currentLevel)
  const targetIndex = LEVEL_ORDER.indexOf(plan.targetLevel)
  if (targetIndex <= currentIndex) {
    return {
      daysRemaining,
      guidedHours: { min: 0, max: 0 },
      guidedHoursPerDay: { min: 0, max: 0 },
    }
  }

  const currentHours = plan.currentLevel === 'A0'
    ? { min: 0, max: 0 }
    : GUIDED_HOURS[plan.currentLevel as TargetLevel]
  const targetHours = GUIDED_HOURS[plan.targetLevel]
  if (!currentHours || !targetHours) {
    return { daysRemaining, guidedHours: null, guidedHoursPerDay: null }
  }

  const min = Math.max(0, targetHours.min - currentHours.max)
  const max = Math.max(0, targetHours.max - currentHours.min)
  const guidedHours = { min, max }
  const guidedHoursPerDay = daysRemaining > 0
    ? { min: min / daysRemaining, max: max / daysRemaining }
    : null

  return { daysRemaining, guidedHours, guidedHoursPerDay }
}
