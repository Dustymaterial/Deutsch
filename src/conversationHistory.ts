type ConversationKind = 'private' | 'group'

export function conversationEntryState(state: unknown, kind: ConversationKind, token: string) {
  const next: Record<string, unknown> = state && typeof state === 'object' ? { ...state } : {}
  delete next.__deutschCompanionChat
  delete next.__deutschCompanionGroup
  next[kind === 'private' ? '__deutschCompanionChat' : '__deutschCompanionGroup'] = token
  return next
}

export function isConversationEntry(state: unknown, token: string) {
  if (!state || typeof state !== 'object') return false
  return ('__deutschCompanionChat' in state && state.__deutschCompanionChat === token)
    || ('__deutschCompanionGroup' in state && state.__deutschCompanionGroup === token)
}
