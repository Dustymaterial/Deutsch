import { createContext } from 'react'
import type { Card } from './deckImport'
import type { StarterEntry } from './starterDeck'
import type { WordEntry } from './wordLookup'
export const WordLookupContext = createContext<{ cards: Card[]; onSavePlural: (id: string, plural: string) => void; onAdd: (entry: WordEntry) => unknown; onAddStarter: (entry: StarterEntry) => unknown }>({ cards: [], onSavePlural: () => {}, onAdd: () => {}, onAddStarter: () => {} })
