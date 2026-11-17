type Message = { id: string; createdAt: string }

export function replayUpdatesInRange<T extends Message>(current: T[], updates: T[]) {
  const oldest = current[0]
  if (!oldest) return updates
  const oldestTime = Date.parse(oldest.createdAt)
  const ids = new Set(current.map((message) => message.id))
  return updates.filter((message) => ids.has(message.id)
    || Date.parse(message.createdAt) > oldestTime
    || (Date.parse(message.createdAt) === oldestTime && message.id >= oldest.id))
}
