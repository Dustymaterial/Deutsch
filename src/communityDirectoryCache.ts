import type { CompanionDirectory } from './CompanionPanel'
import type { GroupDirectory } from './groupsApi'

type Parts = { companions: CompanionDirectory; groups: GroupDirectory }
type Slot<T> = { value?: T; savedAt: number; flight?: Promise<T>; sequence: number }
const maxAge = 5 * 60 * 1000
let owner: string | null = null
let generation = 0
let slots: { [K in keyof Parts]: Slot<Parts[K]> } = {
  companions: { savedAt: 0, sequence: 0 }, groups: { savedAt: 0, sequence: 0 },
}

export function setCommunityCacheOwner(accountId: string | null) {
  if (owner === accountId) return
  owner = accountId
  clearCommunityDirectoryCache()
}

export function clearCommunityDirectoryCache() {
  generation += 1
  slots = { companions: { savedAt: 0, sequence: 0 }, groups: { savedAt: 0, sequence: 0 } }
}

export function getCommunityDirectory<K extends keyof Parts>(accountId: string | null, kind: K): Parts[K] | null {
  const slot = slots[kind]
  return accountId && accountId === owner && slot.value && Date.now() - slot.savedAt < maxAge
    ? slot.value : null
}

export async function loadCommunityDirectory<K extends keyof Parts>(
  accountId: string | null, kind: K, load: () => Promise<Parts[K]>, join = false,
): Promise<Parts[K]> {
  if (!accountId || accountId !== owner) return load()
  const slot: Slot<Parts[K]> = slots[kind]
  const existing = slot.flight
  if (join && existing) return existing
  const epoch = generation
  const sequence = ++slot.sequence
  const promise = load()
  slot.flight = promise
  try {
    const value = await promise
    if (owner === accountId && generation === epoch && slot.sequence === sequence) {
      slot.value = value
      slot.savedAt = Date.now()
    }
    return value
  } finally {
    if (owner === accountId && generation === epoch && slot.flight === promise) delete slot.flight
  }
}
