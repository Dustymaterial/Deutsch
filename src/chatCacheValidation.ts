export function isCachedPrivateMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return 'id' in value && typeof value.id === 'string'
    && 'text' in value && typeof value.text === 'string'
    && 'createdAt' in value && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
    && 'senderId' in value && typeof value.senderId === 'string'
    && 'isMine' in value && typeof value.isMine === 'boolean'
    && 'reported' in value && typeof value.reported === 'boolean'
    && 'kind' in value && ['text', 'word', 'practice', 'unsent'].includes(String(value.kind))
    && 'reactions' in value && Array.isArray(value.reactions)
}
