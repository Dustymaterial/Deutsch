import { useEffect, useRef } from 'react'

export function useChatDelivery({ chatKey, messageIds, enabled, deliver, onError }: {
  chatKey: string | null
  messageIds: string[]
  enabled: boolean
  deliver: (ids: string[]) => Promise<void>
  onError: (failure: unknown) => void
}) {
  const acknowledged = useRef(new Set<string>())
  const idsKey = messageIds.join(',')
  useEffect(() => {
    if (!enabled || !chatKey || !idsKey) return
    let active = true
    let retry: number | undefined
    const send = async () => {
      try {
        const remaining = idsKey.split(',').filter((id) => !acknowledged.current.has(`${chatKey}:${id}`))
        for (let offset = 0; active && offset < remaining.length; offset += 50) {
          const batch = remaining.slice(offset, offset + 50)
          await deliver(batch)
          if (active) batch.forEach((id) => acknowledged.current.add(`${chatKey}:${id}`))
        }
      } catch (failure) {
        if (!active) return
        onError(failure)
        retry = window.setTimeout(() => void send(), 10000)
      }
    }
    void send()
    return () => { active = false; window.clearTimeout(retry) }
  }, [chatKey, idsKey, enabled, deliver, onError])
}
