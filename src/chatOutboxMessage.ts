export type OutboxMessage = {
  id: string
  accountId: string
  kind: 'private' | 'group'
  chatId: string
  recipientId?: string
  text: string
  wordPractice?: boolean
  replyTo?: { id: string; isMine: boolean; text: string }
  createdAt: string
  status: 'sending' | 'sent' | 'failed'
  deliveryUnconfirmed?: boolean
  error?: string
}

const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/.test(value)
export function isOutboxMessage(value: unknown): value is OutboxMessage {
  if (!value || typeof value !== 'object') return false
  const now = Date.now()
  const item = value as Partial<OutboxMessage>
  return id(item.id) && id(item.accountId) && (item.kind === 'private' || item.kind === 'group')
    && typeof item.chatId === 'string' && (id(item.chatId) || /^opening:[a-f\d]{24}$/.test(item.chatId))
    && (item.recipientId === undefined || id(item.recipientId))
    && typeof item.text === 'string' && item.text.trim().length > 0 && item.text.length <= (item.kind === 'group' ? 1000 : 2000)
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
    && Date.parse(item.createdAt) <= now && now - Date.parse(item.createdAt) < 24 * 60 * 60 * 1000
    && ['sending', 'sent', 'failed'].includes(item.status ?? '')
    && (item.wordPractice === undefined || typeof item.wordPractice === 'boolean')
    && (item.deliveryUnconfirmed === undefined || typeof item.deliveryUnconfirmed === 'boolean')
    && (item.error === undefined || (typeof item.error === 'string' && item.error.length <= 400))
    && (item.replyTo === undefined || (item.replyTo !== null && typeof item.replyTo === 'object' && id(item.replyTo.id) && typeof item.replyTo.isMine === 'boolean'
      && typeof item.replyTo.text === 'string' && item.replyTo.text.length <= 2000))
}

export const restoreOutboxMessage = (item: OutboxMessage): OutboxMessage => item.status === 'sending'
  ? { ...item, status: 'failed', deliveryUnconfirmed: true, error: 'Delivery was not confirmed. Retry to check and send.' }
  : item
