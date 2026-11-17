import { useCallback, useEffect, useState } from 'react'

const pollMs = 30000

// Quiet badge count for the floating launcher; failures leave the last count in place.
export function useUnreadMessages(enabled: boolean, paused: boolean) {
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const response = await fetch('/api/companions/unread')
      if (!response.ok) return
      const data: unknown = await response.json()
      if (data && typeof data === 'object' && 'count' in data && typeof data.count === 'number') {
        setCount(Math.max(0, Math.floor(data.count)))
      }
    } catch {
      // Offline or the service is down; keep the previous count.
    }
  }, [])

  useEffect(() => {
    if (!enabled || paused) return undefined
    const first = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), pollMs)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [enabled, paused, refresh])

  return enabled ? count : 0
}
