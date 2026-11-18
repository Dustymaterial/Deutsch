import { useCallback, useRef, useState } from 'react'

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
  error?: string
}

export function useChatOutbox() {
  const [items, setItems] = useState<OutboxMessage[]>([])
  const owner = useRef<string | null>(null)
  const inFlight = useRef(new Set<string>())

  const setOwner = useCallback((accountId: string | null) => {
    if (owner.current === accountId) return
    owner.current = accountId
    setItems([])
  }, [])

  const send = useCallback(async (item: OutboxMessage) => {
    if (owner.current !== item.accountId || inFlight.current.has(item.id)) return
    inFlight.current.add(item.id)
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'sending', error: undefined } : entry))
    try {
      const body = { text: item.text, clientId: item.id, ...(item.replyTo ? { replyToId: item.replyTo.id } : {}), ...(item.kind === 'group' && item.wordPractice ? { wordPractice: true } : {}) }
      const api = item.kind === 'private' ? await import('./companionsApi') : await import('./groupsApi')
      if (owner.current !== item.accountId) return
      let chatId = item.chatId
      if (item.recipientId && item.chatId.startsWith('opening:') && 'request' in api) {
        const opened = await api.request('/chats/open', { id: item.recipientId })
        if (!opened || typeof opened !== 'object' || !('id' in opened) || typeof opened.id !== 'string'
          || !/^[a-f\d]{24}$/.test(opened.id)) throw new Error('Could not open this conversation.')
        chatId = opened.id
        if (owner.current !== item.accountId) return
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, chatId } : entry))
      }
      const result = 'request' in api
        ? await api.request(`/chats/${chatId}/messages`, body)
        : await api.groupsRequest(`/${chatId}/messages`, body)
      if (!result || typeof result !== 'object' || !('message' in result)
        || !result.message || typeof result.message !== 'object' || !('id' in result.message)
        || result.message.id !== item.id) {
        throw new Error('The server could not confirm this message. Check the connection and try again.')
      }
      if (owner.current === item.accountId) {
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'sent' } : entry))
      }
    } catch (failure) {
      if (owner.current === item.accountId) {
        setItems((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: 'failed', error: failure instanceof Error ? failure.message : 'Could not send this message.' } : entry))
      }
    } finally {
      inFlight.current.delete(item.id)
    }
  }, [])

  const enqueue = useCallback((input: Pick<OutboxMessage, 'kind' | 'chatId' | 'text' | 'replyTo' | 'recipientId' | 'wordPractice'>) => {
    const accountId = owner.current
    if (!accountId) throw new Error('Sign in before sending a message.')
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const item: OutboxMessage = { ...input, id, accountId, createdAt: new Date().toISOString(), status: 'sending' }
    setItems((current) => [...current, item])
    void send(item)
  }, [send])

  const discard = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id || item.status !== 'failed'))
  }, [])
  const reconcile = useCallback((kind: OutboxMessage['kind'], chatId: string, ids: string[]) => {
    const found = new Set(ids)
    setItems((current) => {
      const next = current.filter((item) => item.kind !== kind || item.chatId !== chatId || !found.has(item.id))
      return next.length === current.length ? current : next
    })
  }, [])
  return { items, enqueue, retry: send, discard, reconcile, setOwner }
}

export type ChatOutbox = ReturnType<typeof useChatOutbox>
