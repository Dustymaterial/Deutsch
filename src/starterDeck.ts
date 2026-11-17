import { isDeckCard, normalizeDeckCard, type Card } from './deckImport.ts'

export const deckStorageKey = 'deutsch-deck-v1'
export type LoadedDeck = { cards: Card[]; warning: string | null; canSave: boolean }
export type StarterPack = typeof import('./data/german-starter-pack.json')
export type StarterEntry = StarterPack['cards'][number]

export const loadStarterPack = async (): Promise<StarterPack> =>
  (await import('./data/german-starter-pack.json')).default

export const makeCard = (
  id: string,
  prompt: string,
  meaning: string,
  example: string,
  translation: string,
  category: string,
  tags: string[],
  forms: { article?: string; plural?: string } = {},
): Card => ({
  id,
  prompt,
  ...forms,
  meaning,
  example,
  translation,
  category,
  tags,
  status: 'active',
  dueAt: new Date().toISOString(),
  intervalDays: 0,
  repetitions: 0,
  easeFactor: 2.5,
  lapses: 0,
  lastReviewedAt: null,
  lastRating: null,
  correctCount: 0,
  incorrectCount: 0,
  reviewHistory: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const cardFromStarterEntry = (entry: StarterEntry) =>
  makeCard(
    entry.id,
    entry.article ? `${entry.article} ${entry.word}` : entry.word,
    entry.meaning,
    entry.example,
    entry.translation,
    entry.category,
    [...new Set([...entry.tags, entry.level])],
    entry.article
      ? { article: entry.article, ...(entry.plural ? { plural: entry.plural } : {}) }
      : {},
  )

export const createSeedDeck = (starterPack: StarterPack): Card[] => starterPack.cards.map(cardFromStarterEntry)

export async function loadDeck(): Promise<LoadedDeck> {
  let warning: string | null = null
  let canSave = true
  try {
    const raw = localStorage.getItem(deckStorageKey)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed) || !parsed.every(isDeckCard)) {
        warning = 'The saved deck is invalid. Your saved data has not been overwritten.'
        canSave = false
      } else if (parsed.length > 0) {
        return { cards: parsed.map(normalizeDeckCard), warning: null, canSave: true }
      }
    }
  } catch {
    warning = 'The saved deck could not be read. Your saved data has not been overwritten.'
    canSave = false
  }
  return { cards: createSeedDeck(await loadStarterPack()), warning, canSave }
}
