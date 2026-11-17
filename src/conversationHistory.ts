type ConversationKind = 'private' | 'group'

export function conversationEntryState(state: unknown, kind: ConversationKind, token: string) {
  const next: Record<string, unknown> = state && typeof state === 'object' ? { ...state } : {}
  delete next.__deutschCompanionChat
  delete next.__deutschCompanionGroup
  delete next.__deutschChatOverlay
  next[kind === 'private' ? '__deutschCompanionChat' : '__deutschCompanionGroup'] = token
  return next
}

export function chatOverlayEntryState(state: unknown, conversation: string, token: string) {
  const next: Record<string, unknown> = state && typeof state === 'object' ? { ...state } : {}
  next.__deutschChatOverlay = { conversation, token }
  return next
}

export function isChatOverlayEntry(state: unknown, conversation: string, token?: string) {
  if (!isConversationEntry(state, conversation) || !state || typeof state !== 'object'
    || !('__deutschChatOverlay' in state)) return false
  const overlay = state.__deutschChatOverlay
  return Boolean(overlay && typeof overlay === 'object' && 'conversation' in overlay
    && overlay.conversation === conversation && 'token' in overlay
    && typeof overlay.token === 'string' && (!token || overlay.token === token))
}

export function withoutChatOverlay(state: unknown) {
  const next: Record<string, unknown> = state && typeof state === 'object' ? { ...state } : {}
  delete next.__deutschChatOverlay
  return next
}

export function orderChatOverlays(previous: string[], active: string[]) {
  const remaining = previous.filter((item) => active.includes(item))
  return [...remaining, ...active.filter((item) => !remaining.includes(item))]
}

export function isConversationEntry(state: unknown, token: string) {
  if (!state || typeof state !== 'object') return false
  return ('__deutschCompanionChat' in state && state.__deutschCompanionChat === token)
    || ('__deutschCompanionGroup' in state && state.__deutschCompanionGroup === token)
}
