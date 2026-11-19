import { isDeckCard, normalizeDeckCard, type Card } from './deckImport.ts'
import { mergeAccountCards } from './accountSync.ts'
import { deckStorageKey } from './starterDeck.ts'

type Environment = {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  locks?: Pick<LockManager, 'request'>
  indexedDB: IDBFactory
}
const environment = (): Environment => ({ storage: localStorage, locks: globalThis.navigator?.locks, indexedDB: globalThis.indexedDB })

export class DeckConflictError extends Error {
  constructor() { super('This word or deck changed in another tab. Reload before saving this action.') }
}
export class DeckLimitError extends Error {}

// The callback is synchronous. The IDB fallback holds an exclusive read/write
// transaction while reading and committing localStorage, without migrating data.
export function withDeckWriteLock<T>(action: () => T, env = environment()): Promise<T> {
  if (env.locks) return env.locks.request('deutsch-deck-write', { mode: 'exclusive' }, action)
  return new Promise((resolve, reject) => {
    const open = env.indexedDB.open('deutsch-deck-coordination', 1)
    let blocked = false
    open.onupgradeneeded = () => open.result.createObjectStore('writer')
    open.onerror = () => reject(open.error)
    open.onblocked = () => { blocked = true; reject(new Error('Another tab is blocking saved progress. Close it and try again.')) }
    open.onsuccess = () => {
      const db = open.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => db.close()
      let tx: IDBTransaction
      try { tx = db.transaction('writer', 'readwrite') }
      catch (error) { db.close(); reject(error); return }
      tx.oncomplete = () => db.close()
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Progress coordination failed.')) }
      const request = tx.objectStore('writer').get('deck')
      request.onsuccess = () => {
        try { resolve(action()) }
        catch (error) { reject(error); tx.abort() }
      }
    }
  })
}

function readStoredDeck(storage: Environment['storage'], fallback: Card[]) {
  const raw = storage.getItem(deckStorageKey)
  if (raw === null) return fallback
  const cards: unknown = JSON.parse(raw)
  if (!Array.isArray(cards) || !cards.every(isDeckCard) || new Set(cards.map((card) => card.id)).size !== cards.length) throw new Error('Saved progress could not be read safely. Export or restore it before continuing.')
  return cards.map(normalizeDeckCard)
}
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length
    && keys.every((key) => same(left[key], right[key]))
}

export function mergeDeckChanges(base: Card[], next: Card[], latest: Card[]): Card[] {
  if (!next.every(isDeckCard) || new Set(next.map((card) => card.id)).size !== next.length) throw new Error('The deck contains invalid or duplicate words.')
  base = base.map(normalizeDeckCard)
  next = next.map(normalizeDeckCard)
  const before = new Map(base.map((card) => [card.id, card]))
  const after = new Map(next.map((card) => [card.id, card]))
  const merged = new Map(latest.map((card) => [card.id, card]))
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id)
    const changed = after.get(id)
    if (old === changed || same(old, changed)) continue
    const saved = merged.get(id)
    if (!same(old, saved) && !(old === undefined && same(changed, saved))) throw new DeckConflictError()
    if (changed) merged.set(id, changed)
    else merged.delete(id)
  }
  return [...merged.values()]
}

export async function commitDeckChanges(base: Card[], next: Card[], env = environment(), validateLatest?: (cards: Card[]) => void): Promise<Card[]> {
  return withDeckWriteLock(() => {
    const latest = readStoredDeck(env.storage, base)
    validateLatest?.(latest)
    const merged = mergeDeckChanges(base, next, latest)
    env.storage.setItem(deckStorageKey, JSON.stringify(merged))
    return merged
  }, env)
}

export async function mergeStoredAccountDeck(fallback: Card[], remote: Card[], env = environment(), shouldCommit?: () => boolean): Promise<Card[]> {
  return withDeckWriteLock(() => {
    if (shouldCommit && !shouldCommit()) throw new DOMException('Progress sync cancelled.', 'AbortError')
    const merged = mergeAccountCards(readStoredDeck(env.storage, fallback), remote)
    env.storage.setItem(deckStorageKey, JSON.stringify(merged))
    return merged
  }, env)
}

export async function replaceStoredDeck(base: Card[], next: Card[], env = environment()): Promise<Card[]> {
  return withDeckWriteLock(() => {
    let latest: Card[]
    try { latest = readStoredDeck(env.storage, base) }
    catch { latest = base } // Explicit confirmed recovery may replace an invalid deck.
    if (!same(base.map(normalizeDeckCard), latest.map(normalizeDeckCard))) throw new DeckConflictError()
    env.storage.setItem(deckStorageKey, JSON.stringify(next))
    return next
  }, env)
}
