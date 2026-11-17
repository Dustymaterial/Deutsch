import { useCallback, useEffect, useRef } from 'react'

export function useChatTyping(
  send: (chatId: string, typing: boolean) => Promise<void>,
  onError: (failure: unknown) => void,
) {
  const previous = useRef<{ chatId: string; typing: boolean; sentAt: number } | null>(null)
  const pending = useRef<Promise<void>>(Promise.resolve())
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  return useCallback((chatId: string, typing: boolean) => {
    const last = previous.current
    const now = Date.now()
    if (typing && last?.chatId === chatId && last.typing && now - last.sentAt < 3000) return
    if (!typing && (last?.chatId !== chatId || !last.typing)) return
    previous.current = { chatId, typing, sentAt: now }
    pending.current = pending.current.then(() => active.current ? send(chatId, typing) : undefined).catch((failure: unknown) => {
      if (previous.current?.chatId === chatId && previous.current.sentAt === now) previous.current = null
      if (active.current) onError(failure)
    })
  }, [send, onError])
}
