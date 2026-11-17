let pendingRetreat: { remaining: number | null } | null = null
const retreatListeners = new Set<() => void>()

export function chatOverlayRetreatPending() {
  return pendingRetreat !== null
}

export function onChatOverlayRetreat(listener: () => void) {
  retreatListeners.add(listener)
  return () => { retreatListeners.delete(listener) }
}

export function retreatChatOverlay() {
  if (pendingRetreat) return
  const pending = { remaining: null as number | null }
  pendingRetreat = pending
  const finish = () => {
    window.removeEventListener('popstate', finish)
    if (pendingRetreat === pending) pendingRetreat = null
    if (pending.remaining !== null) {
      if (pending.remaining) window.history.go(-pending.remaining)
    } else {
      for (const listener of retreatListeners) listener()
    }
  }
  window.addEventListener('popstate', finish)
  window.history.back()
}

export function leaveChatHistory(steps: number) {
  if (pendingRetreat) pendingRetreat.remaining = Math.max(0, steps - 1)
  else window.history.go(-steps)
}
