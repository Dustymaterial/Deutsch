export type CachedChatPage<T> = {
  messages: T[]
  hasMore: boolean
  cursor?: string
}

export class ChatMemoryCache<T> {
  private readonly pages = new Map<string, { page: CachedChatPage<T>; savedAt: number }>()
  private readonly maxConversations: number
  private readonly maxMessages: number
  private readonly maxAgeMs: number

  constructor(maxConversations = 20, maxMessages = 50, maxAgeMs = 30_000) {
    this.maxConversations = maxConversations
    this.maxMessages = maxMessages
    this.maxAgeMs = maxAgeMs
  }

  get(id: string, now = Date.now()): CachedChatPage<T> | null {
    const entry = this.pages.get(id)
    if (!entry) return null
    if (now - entry.savedAt >= this.maxAgeMs || now < entry.savedAt) {
      this.pages.delete(id)
      return null
    }
    this.pages.delete(id)
    this.pages.set(id, entry)
    return entry.page
  }

  set(id: string, page: CachedChatPage<T>, now = Date.now()) {
    this.pages.delete(id)
    this.pages.set(id, {
      page: { ...page, messages: page.messages.slice(-this.maxMessages), hasMore: page.hasMore || page.messages.length > this.maxMessages },
      savedAt: now,
    })
    while (this.pages.size > this.maxConversations) {
      const oldest = this.pages.keys().next().value
      if (oldest === undefined) break
      this.pages.delete(oldest)
    }
  }

  delete(id: string) {
    this.pages.delete(id)
  }

  entries(now = Date.now()): [string, CachedChatPage<T>][] {
    return [...this.pages.keys()].flatMap((id) => {
      const page = this.get(id, now)
      return page ? [[id, page] as [string, CachedChatPage<T>]] : []
    })
  }

  retain(ids: Set<string>) {
    for (const id of this.pages.keys()) {
      if (!ids.has(id)) this.pages.delete(id)
    }
  }
}
