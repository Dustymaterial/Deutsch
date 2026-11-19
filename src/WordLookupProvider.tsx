import { useMemo, type ReactNode } from 'react'
import { WordLookupContext as Context } from './wordLookupContext'
import type { Card } from './deckImport'
import type { StarterEntry } from './starterDeck'
import type { WordEntry } from './wordLookup'
export function WordLookupProvider({ cards, onAdd, onAddStarter, children }: {
  cards: Card[]; onAdd: (entry: WordEntry) => unknown; onAddStarter: (entry: StarterEntry) => unknown; children: ReactNode
}) {
  const value = useMemo(() => ({ cards, onAdd, onAddStarter }), [cards, onAdd, onAddStarter])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
