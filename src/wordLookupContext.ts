import { createContext } from 'react'
import type { Card } from './deckImport'
import type { StarterEntry } from './starterDeck'
import type { WordEntry } from './wordLookup'
export const WordLookupContext = createContext<{ cards: Card[]; onAdd: (entry: WordEntry) => unknown; onAddStarter: (entry: StarterEntry) => unknown }>({ cards: [], onAdd: () => {}, onAddStarter: () => {} })
