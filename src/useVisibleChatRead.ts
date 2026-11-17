import { useEffect, useRef, type RefObject } from 'react'

export function useVisibleChatRead({
  chatKey, messageId, enabled, stream, markRead, onRead, onError,
}: {
  chatKey: string | null
  messageId: string | null
  enabled: boolean
  stream: RefObject<HTMLDivElement | null>
  markRead: (messageId: string) => Promise<void>
  onRead: () => void
  onError: (failure: unknown) => void
}) {
  const acknowledged = useRef<string | null>(null)

  useEffect(() => {
    const element = stream.current
    if (!enabled || !chatKey || !messageId || !element) return
    let active = true
    let inFlight = false
    const key = `${chatKey}:${messageId}`
    const check = () => {
      if (document.visibilityState !== 'visible' || acknowledged.current === key || inFlight
        || element.scrollHeight - element.scrollTop - element.clientHeight >= 160) return
      inFlight = true
      void markRead(messageId).then(() => {
        if (active) {
          acknowledged.current = key
          onRead()
        }
      }).catch((failure: unknown) => {
        if (active) onError(failure)
      }).finally(() => {
        inFlight = false
      })
    }
    const frame = requestAnimationFrame(check)
    element.addEventListener('scroll', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      element.removeEventListener('scroll', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [chatKey, messageId, enabled, stream, markRead, onRead, onError])
}
