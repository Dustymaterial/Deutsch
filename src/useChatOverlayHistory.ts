import { useEffect, useLayoutEffect, useRef } from 'react'
import { chatOverlayEntryState, isChatOverlayEntry, isConversationEntry, orderChatOverlays } from './conversationHistory'
import { chatOverlayRetreatPending, onChatOverlayRetreat, retreatChatOverlay } from './chatHistoryNavigation'

export function useChatOverlayHistory(chat: string | null, open: string, close: (overlay: string) => void) {
  const entry = useRef<{ conversation: string; token: string } | null>(null)
  const closeRef = useRef(close)
  const overlays = useRef<string[]>([])
  const previousChat = useRef(chat)

  useLayoutEffect(() => { closeRef.current = close }, [close])

  useLayoutEffect(() => {
    const active = open ? open.split(',') : []
    if (previousChat.current !== chat) overlays.current = []
    previousChat.current = chat
    overlays.current = orderChatOverlays(overlays.current, active)
    const state = window.history.state
    const conversation = state?.__deutschCompanionChat ?? state?.__deutschCompanionGroup
    if (open && chat && typeof conversation === 'string' && !entry.current && !chatOverlayRetreatPending() && isConversationEntry(state, conversation)) {
      const token = crypto.randomUUID()
      window.history.pushState(chatOverlayEntryState(state, conversation, token), '', window.location.href)
      entry.current = { conversation, token }
    } else if (!open && entry.current) {
      const { token, conversation } = entry.current
      entry.current = null
      if (isChatOverlayEntry(window.history.state, conversation, token)) {
        retreatChatOverlay()
      }
    }
  }, [chat, open])

  useEffect(() => {
    const handleBack = (event: PopStateEvent) => {
      if (chatOverlayRetreatPending()) return
      const current = entry.current
      if (!current || isChatOverlayEntry(event.state, current.conversation, current.token)) return
      entry.current = null
      const top = overlays.current.at(-1)
      if (top) closeRef.current(top)
    }
    window.addEventListener('popstate', handleBack)
    const unsubscribe = onChatOverlayRetreat(() => {
      const state = window.history.state
      const conversation = state?.__deutschCompanionChat ?? state?.__deutschCompanionGroup
      if (!entry.current && overlays.current.length && previousChat.current && typeof conversation === 'string'
        && isConversationEntry(state, conversation)) {
        const token = crypto.randomUUID()
        window.history.pushState(chatOverlayEntryState(state, conversation, token), '', window.location.href)
        entry.current = { conversation, token }
      }
    })
    return () => {
      window.removeEventListener('popstate', handleBack)
      unsubscribe()
      const current = entry.current
      entry.current = null
      if (current && isChatOverlayEntry(window.history.state, current.conversation, current.token)) retreatChatOverlay()
    }
  }, [chat])
}
