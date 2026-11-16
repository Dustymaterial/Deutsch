export type LearnHistory = { ids: string[]; index: number }

export const emptyLearnHistory = (): LearnHistory => ({ ids: [], index: -1 })

export const visitLearnWord = (history: LearnHistory, id: string): LearnHistory => {
  if (history.ids[history.index] === id) return history
  const ids = [...history.ids.slice(0, history.index + 1), id]
  return { ids, index: ids.length - 1 }
}

export const moveLearnHistory = (
  history: LearnHistory,
  direction: -1 | 1,
  available: ReadonlySet<string>,
): LearnHistory | null => {
  for (let index = history.index + direction; index >= 0 && index < history.ids.length; index += direction) {
    if (available.has(history.ids[index])) return { ...history, index }
  }
  return null
}
