import { useCallback, useEffect, useRef, useState } from 'react'

import { PersistentChatCache, chatCacheEnabled, chatCacheClearedKey, chatCachePreferenceEvent } from './chatPersistentCache'
import { isOutboxMessage, restoreOutboxMessage, type OutboxMessage } from './chatOutboxMessage'
export type { OutboxMessage } from './chatOutboxMessage'

export function useChatOutbox() {
  const [items, setItems] = useState<OutboxMessage[]>([])
  const owner = useRef<string | null>(null)
  const ownerGeneration = useRef(0)
  const itemsRef = useRef<OutboxMessage[]>([])
  const cache = useRef<PersistentChatCache<OutboxMessage> | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const commitItems = useCallback((change: (items: OutboxMessage[]) => OutboxMessage[]) => {
    const previous = itemsRef.current
    const next = change(previous)
    itemsRef.current = next
    setItems(next)
    const before = new Map(previous.map((item) => [item.id, item]))
    const after = new Set(next.map((item) => item.id))
    for (const item of next) if (before.get(item.id) !== item) cache.current?.set(item.id, { messages: [item], hasMore: false })
    for (const item of previous) if (!after.has(item.id)) cache.current?.delete(item.id)
  }, [])
  const openCache = useCallback((accountId: string) => {
    cache.current?.stop()
    cache.current = null
    try {
      if (!chatCacheEnabled()) return null
      const next = new PersistentChatCache<OutboxMessage>(accountId, 'outbox', true,
        (value): value is OutboxMessage => isOutboxMessage(value) && value.accountId === accountId,
        () => setStorageError('Pending messages could not be saved on this device. Keep the app open until delivery is confirmed.'))
      cache.current = next
      return next
    } catch {
      setStorageError('Pending messages could not be saved on this device. Keep the app open until delivery is confirmed.')
      return null
    }
  }, [])
  const inFlight = useRef(new Map<string, number>())

  const setOwner = useCallback((accountId: string | null) => {
    if (owner.current === accountId) return
    ownerGeneration.current += 1
    inFlight.current.clear()
    cache.current?.stop()
    cache.current = null
    owner.current = accountId
    itemsRef.current = []
    setItems([])
    setStorageError(null)
    if (!accountId) return
    const store = openCache(accountId)
    if (store) void store.whenReady().then(() => {
      if (owner.current !== accountId || cache.current !== store) return
      const restored = store.entries().map(([, page]) => restoreOutboxMessage(page.messages[0]))
      commitItems((current) => [...current, ...restored.filter((item) => !current.some((entry) => entry.id === item.id))]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).slice(-20))
    })
  }, [openCache, commitItems])

  const send = useCallback(async (item: OutboxMessage) => {
    if (owner.current !== item.accountId || inFlight.current.has(item.id) || !itemsRef.current.some((entry) => entry.id === item.id)) return
    const generation = ownerGeneration.current
    const ownsRequest = () => owner.current === item.accountId && ownerGeneration.current === generation
    inFlight.current.set(item.id, generation)
    commitItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'sending', error: undefined, deliveryUnconfirmed: undefined } : entry))
    try {
      const body = { text: item.text, clientId: item.id, ...(item.replyTo ? { replyToId: item.replyTo.id } : {}), ...(item.kind === 'group' && item.wordPractice ? { wordPractice: true } : {}) }
      const api = item.kind === 'private' ? await import('./companionsApi') : await import('./groupsApi')
      if (!ownsRequest()) return
      let chatId = item.chatId
      if (item.recipientId && item.chatId.startsWith('opening:') && 'request' in api) {
        const opened = await api.request('/chats/open', { id: item.recipientId })
        if (!opened || typeof opened !== 'object' || !('id' in opened) || typeof opened.id !== 'string'
          || !/^[a-f\d]{24}$/.test(opened.id)) throw new Error('Could not open this conversation.')
        chatId = opened.id
        if (!ownsRequest()) return
        commitItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, chatId } : entry))
      }
      const result = 'request' in api
        ? await api.request(`/chats/${chatId}/messages`, body)
        : await api.groupsRequest(`/${chatId}/messages`, body)
      if (!result || typeof result !== 'object' || !('message' in result)
        || !result.message || typeof result.message !== 'object' || !('id' in result.message)
        || result.message.id !== item.id) {
        throw new Error('The server could not confirm this message. Check the connection and try again.')
      }
      if (ownsRequest()) {
        commitItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'sent' } : entry))
      }
    } catch (failure) {
      if (ownsRequest()) {
        commitItems((current) => current.map((entry) => entry.id === item.id
          ? { ...entry, status: 'failed', deliveryUnconfirmed: !(failure instanceof Error && 'status' in failure && typeof failure.status === 'number' && failure.status >= 400), error: (failure instanceof Error ? failure.message : 'Could not send this message.').slice(0, 400) } : entry))
      }
    } finally {
      if (inFlight.current.get(item.id) === generation) inFlight.current.delete(item.id)
    }
  }, [commitItems])

  const enqueue = useCallback((input: Pick<OutboxMessage, 'kind' | 'chatId' | 'text' | 'replyTo' | 'recipientId' | 'wordPractice'>) => {
    const accountId = owner.current
    if (!accountId) throw new Error('Sign in before sending a message.')
    if (itemsRef.current.filter((item) => item.status !== 'sent').length >= 20) throw new Error('Resolve pending messages before sending more.')
    const bytes = crypto.getRandomValues(new Uint8Array(12))
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    const item: OutboxMessage = { ...input, id, accountId, createdAt: new Date().toISOString(), status: 'sending' }
    commitItems((current) => [...(current.length >= 20 ? current.filter((entry) => entry.status !== 'sent') : current), item])
    void send(item)
  }, [send, commitItems])

  const discard = useCallback((id: string) => {
    commitItems((current) => current.filter((item) => item.id !== id || item.status !== 'failed'))
  }, [commitItems])
  const reconcile = useCallback((kind: OutboxMessage['kind'], chatId: string, ids: string[]) => {
    const found = new Set(ids)
    commitItems((current) => {
      const next = current.filter((item) => item.kind !== kind || item.chatId !== chatId || !found.has(item.id))
      return next.length === current.length ? current : next
    })
  }, [commitItems])
  useEffect(() => {
    const cleared = (event: Event) => {
      const accountId = owner.current
      if (!accountId) return
      const value = event instanceof StorageEvent ? event.newValue : (event as CustomEvent<string>).detail
      if (!value || !(value === '*' || value === accountId || value.startsWith(`${accountId}:`) || value.startsWith('*:'))) return
      cache.current?.stop()
      cache.current = null
      itemsRef.current = []
      setItems([])
      openCache(accountId)
    }
    const preference = () => {
      if (!owner.current) return
      const store = openCache(owner.current)
      for (const item of itemsRef.current) store?.set(item.id, { messages: [item], hasMore: false })
    }
    const storage = (event: StorageEvent) => {
      if (event.key === chatCacheClearedKey) cleared(event)
      else if (event.key === 'deutsch-chat-cache-enabled') preference()
    }
    window.addEventListener('storage', storage)
    window.addEventListener(chatCacheClearedKey, cleared)
    window.addEventListener(chatCachePreferenceEvent, preference)
    return () => {
      window.removeEventListener('storage', storage)
      window.removeEventListener(chatCacheClearedKey, cleared)
      window.removeEventListener(chatCachePreferenceEvent, preference)
      // Let queued delivery writes finish through unmount/StrictMode cleanup.
      // Account changes and explicit clearing invalidate the cache separately.
    }
  }, [openCache])
  return { items, enqueue, retry: send, discard, reconcile, setOwner, storageError }
}

export type ChatOutbox = ReturnType<typeof useChatOutbox>
