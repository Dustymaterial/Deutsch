import { ChatMemoryCache, type CachedChatPage } from './chatMemoryCache.ts'

const databaseName = 'deutsch-chat-cache'
const preferenceKey = 'deutsch-chat-cache-enabled'
export const chatCacheClearedKey = 'deutsch-chat-cache-cleared'
const maxAge = 24 * 60 * 60 * 1000
const maxPages = 20
const maxMessages = 50
type Kind = 'private' | 'group'
type PageRecord = { accountId: string; kind: Kind; id: string; savedAt: number; page: unknown }
type Metadata = { accountId: string; generation: number }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const pages = request.result.createObjectStore('pages', { keyPath: ['accountId', 'kind', 'id'] })
      pages.createIndex('account', 'accountId')
      pages.createIndex('accountKind', ['accountId', 'kind'])
      request.result.createObjectStore('accounts', { keyPath: 'accountId' })
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open chat storage.'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('Chat storage is blocked by another tab.'))
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (blocked) db.close()
      else resolve(db)
    }
  })
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (stores: { pages: IDBObjectStore; accounts: IDBObjectStore }, finish: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(['pages', 'accounts'], mode)
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    let result: T
    let finished = false
    let failure: Error | undefined
    tx.oncomplete = () => {
      db.close()
      if (finished) resolve(result)
      else reject(new Error('Chat storage transaction returned no result.'))
    }
    tx.onabort = () => { db.close(); reject(failure ?? tx.error ?? new Error('Chat storage transaction failed.')) }
    tx.onerror = () => { failure ??= tx.error ?? new Error('Chat storage transaction failed.') }
    try {
      operation(
        { pages: tx.objectStore('pages'), accounts: tx.objectStore('accounts') },
        (value) => { result = value; finished = true },
        (error) => { failure = error; tx.abort() },
      )
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Chat storage transaction failed.')
      tx.abort()
    }
  })
}

export function chatCacheEnabled() {
  return localStorage.getItem(preferenceKey) !== 'false'
}

export function setChatCacheEnabled(enabled: boolean) {
  localStorage.setItem(preferenceKey, String(enabled))
}

export async function clearChatCache(accountId?: string) {
  await transaction<void>('readwrite', ({ pages, accounts }, finish) => {
    const cursor = accounts.openCursor()
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) return
      const account = item.value as Metadata
      if (!accountId || account.accountId === accountId) item.update({ ...account, generation: account.generation + 1 })
      item.continue()
    }
    if (accountId) {
      const request = pages.index('account').openKeyCursor(IDBKeyRange.only(accountId))
      request.onsuccess = () => {
        const item = request.result
        if (!item) return
        pages.delete(item.primaryKey)
        item.continue()
      }
    } else {
      pages.clear()
    }
    finish()
  })
  localStorage.setItem(chatCacheClearedKey, `${accountId ?? '*'}:${crypto.randomUUID()}`)
}

export class PersistentChatCache<T> extends ChatMemoryCache<T> {
  private readonly accountId: string
  private readonly kind: Kind
  private readonly isMessage: (value: unknown) => value is T
  private readonly onError: (error: unknown) => void
  private active: boolean
  private generation: number | null = null
  private readonly changed = new Set<string>()
  private allowed: Set<string> | null = null
  private queue: Promise<void> = Promise.resolve()
  private ready: Promise<void>
  private hydrating = false
  private epoch = 0

  constructor(
    accountId: string,
    kind: Kind,
    enabled: boolean,
    isMessage: (value: unknown) => value is T,
    onError: (error: unknown) => void,
  ) {
    super(maxPages, maxMessages, maxAge)
    this.accountId = accountId
    this.kind = kind
    this.isMessage = isMessage
    this.onError = onError
    this.active = enabled
    this.ready = enabled ? this.initialize() : Promise.resolve()
  }

  private async initialize() {
    const epoch = ++this.epoch
    this.hydrating = true
    try {
      const data = await transaction<{ generation: number; pages: PageRecord[] }>('readwrite', ({ accounts, pages }, finish) => {
        const account = accounts.get(this.accountId)
        account.onsuccess = () => {
          const current = account.result as Metadata | undefined
          const generation = current?.generation ?? 0
          if (!current) accounts.put({ accountId: this.accountId, generation })
          const request = pages.index('accountKind').getAll(IDBKeyRange.only([this.accountId, this.kind]))
          request.onsuccess = () => {
            const now = Date.now()
            const records = request.result as PageRecord[]
            const fresh = records.filter((record) => {
              const valid = typeof record.savedAt === 'number' && Number.isFinite(record.savedAt)
                && record.savedAt <= now && now - record.savedAt < maxAge
              if (!valid) pages.delete([this.accountId, this.kind, record.id])
              return valid
            })
            finish({ generation, pages: fresh })
          }
        }
      })
      if (!this.active || epoch !== this.epoch) return
      this.generation = data.generation
      for (const record of data.pages.sort((a, b) => a.savedAt - b.savedAt)) {
        if (this.changed.has(record.id) || (this.allowed && !this.allowed.has(record.id))) continue
        const page = record.page
        if (!page || typeof page !== 'object' || !('messages' in page) || !Array.isArray(page.messages)
          || !page.messages.every(this.isMessage) || !('hasMore' in page) || typeof page.hasMore !== 'boolean'
          || ('cursor' in page && (typeof page.cursor !== 'string' || page.cursor.length > 2048))
          || typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)
          || Date.now() - record.savedAt >= maxAge || record.savedAt > Date.now()) continue
        const cursor = 'cursor' in page && typeof page.cursor === 'string' ? page.cursor : undefined
        super.set(record.id, { messages: page.messages, hasMore: page.hasMore, ...(cursor ? { cursor } : {}) }, record.savedAt)
      }
    } catch (error) {
      if (epoch === this.epoch) {
        this.active = false
        this.onError(error)
      }
    } finally {
      if (epoch === this.epoch) {
        this.hydrating = false
        this.changed.clear()
      }
    }
  }

  whenReady() { return this.ready }

  stop() {
    this.active = false
    this.epoch += 1
    this.hydrating = false
    this.changed.clear()
  }

  start() {
    if (!this.active) {
      this.active = true
      this.ready = this.initialize()
    }
    return this.ready
  }

  private schedule(operation: (pages: IDBObjectStore) => void) {
    if (!this.active) return
    const epoch = this.epoch
    this.queue = this.queue.then(async () => {
      await this.ready
      if (!this.active || epoch !== this.epoch || this.generation === null) return
      await transaction<void>('readwrite', ({ accounts, pages }, finish, fail) => {
        const request = accounts.get(this.accountId)
        request.onsuccess = () => {
          if (!this.active || epoch !== this.epoch) {
            finish()
            return
          }
          const account = request.result as Metadata | undefined
          if (!account || account.generation !== this.generation) {
            fail(new Error('Chat storage was cleared in another session.'))
            return
          }
          operation(pages)
          finish()
        }
      })
    }).catch((error: unknown) => {
      if (epoch === this.epoch) {
        this.active = false
        this.onError(error)
      }
    })
  }

  override set(id: string, page: CachedChatPage<T>, now = Date.now()) {
    if (this.hydrating) this.changed.add(id)
    super.set(id, page, now)
    const bounded = { ...page, messages: page.messages.slice(-maxMessages), hasMore: page.hasMore || page.messages.length > maxMessages }
    this.schedule((pages) => {
      pages.put({ accountId: this.accountId, kind: this.kind, id, savedAt: now, page: bounded })
      const request = pages.index('accountKind').getAll(IDBKeyRange.only([this.accountId, this.kind]))
      request.onsuccess = () => {
        const records = (request.result as PageRecord[]).sort((a, b) => b.savedAt - a.savedAt)
        for (const record of records.slice(maxPages)) pages.delete([this.accountId, this.kind, record.id])
      }
    })
  }

  override delete(id: string) {
    if (this.hydrating) this.changed.add(id)
    super.delete(id)
    this.schedule((pages) => { pages.delete([this.accountId, this.kind, id]) })
  }

  override retain(ids: Set<string>) {
    this.allowed = new Set(ids)
    super.retain(ids)
    this.schedule((pages) => {
      const cursor = pages.index('accountKind').openCursor(IDBKeyRange.only([this.accountId, this.kind]))
      cursor.onsuccess = () => {
        const item = cursor.result
        if (!item) return
        if (!ids.has((item.value as PageRecord).id)) item.delete()
        item.continue()
      }
    })
  }
}
