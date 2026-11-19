import { useMemo, type ReactNode } from 'react'
import { WordLookupContext as Context } from './wordLookupContext'
import type { Card } from './deckImport'
import type { StarterEntry } from './starterDeck'
import type { WordEntry } from './wordLookup'
export function WordLookupProvider({ cards, onAdd, onAddStarter, onSavePlural = () => {}, children }: {
  cards: Card[]; onSavePlural?: (id: string, plural: string) => void; onAdd: (entry: WordEntry) => unknown; onAddStarter: (entry: StarterEntry) => unknown; children: ReactNode
}) {
  const value = useMemo(() => ({ cards, onAdd, onAddStarter, onSavePlural }), [cards, onAdd, onAddStarter, onSavePlural])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
