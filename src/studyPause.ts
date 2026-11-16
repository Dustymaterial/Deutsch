export type PauseSettings = {
  enabled: boolean
  every: 3 | 5 | 10
  seconds: 30 | 60 | 120
}

export type PauseActivity = 'learn' | 'recall' | 'choice' | 'production'

export type PauseState = {
  settings: PauseSettings
  completedIds: string[]
  pending: boolean
  until: number | null
  activity?: PauseActivity
}

export const defaultPauseState = (): PauseState => ({
  settings: { enabled: true, every: 3, seconds: 60 },
  completedIds: [],
  pending: false,
  until: null,
  activity: undefined,
})

export const isPauseState = (value: unknown): value is PauseState => {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PauseState>
  const settings = state.settings
  return Boolean(settings && typeof settings.enabled === 'boolean' &&
    [3, 5, 10].includes(settings.every) && [30, 60, 120].includes(settings.seconds) &&
    Array.isArray(state.completedIds) && state.completedIds.length <= settings.every &&
    state.completedIds.every((id) => typeof id === 'string') &&
    new Set(state.completedIds).size === state.completedIds.length &&
    typeof state.pending === 'boolean' &&
    (state.activity === undefined || ['learn', 'recall', 'choice', 'production'].includes(state.activity)) &&
    (state.until === null || (typeof state.until === 'number' && Number.isFinite(state.until))) &&
    !(state.pending && state.until !== null))
}

export const finishPause = (state: PauseState): PauseState => ({
  ...state, completedIds: [], pending: false, until: null, activity: undefined,
})

export const startPendingPause = (state: PauseState, now: number): PauseState =>
  state.pending
    ? { ...state, completedIds: [], pending: false, until: now + state.settings.seconds * 1000 }
    : state

export const recordPauseWord = (
  state: PauseState,
  id: string,
  now: number,
  defer: boolean,
  activity: PauseActivity,
): PauseState => {
  if (!state.settings.enabled || state.pending || state.until !== null || state.completedIds.includes(id)) return state
  const completedIds = [...state.completedIds, id]
  if (completedIds.length < state.settings.every) return { ...state, completedIds }
  return defer
    ? { ...state, completedIds, pending: true, activity }
    : { ...state, completedIds: [], until: now + state.settings.seconds * 1000, activity }
}

export const restorePause = (state: PauseState, now: number): PauseState => {
  if (!state.settings.enabled || (state.until !== null && state.until <= now)) return finishPause(state)
  return startPendingPause(state, now)
}

export const updatePauseSettings = (state: PauseState, settings: PauseSettings): PauseState =>
  settings.enabled === state.settings.enabled &&
  settings.every === state.settings.every &&
  settings.seconds === state.settings.seconds
    ? state
    : { ...finishPause(state), settings }
