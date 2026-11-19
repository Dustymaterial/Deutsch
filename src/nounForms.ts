import data from './data/noun-form-supplement.json' with { type: 'json' }

export type NounWord = { id?: string; prompt: string; article?: string; meaning: string; category: string; plural?: string }
export type NounFormInfo = { status: 'known' | 'usually-singular' | 'usually-plural' | 'unknown'; plural?: string; source?: string; note?: string }
const key = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase('de-DE')
export const getNounFormInfo = (card: NounWord): NounFormInfo | null => {
  if (card.category !== 'noun') return null
  if (card.plural?.trim()) return { status: 'known', plural: card.plural }
  const word = card.prompt.trim().replace(/^(der|die|das)\s+/i, '')
  const found = data.entries.find((entry) => key(entry.word) === key(word) && entry.article === card.article && key(entry.meaning) === key(card.meaning))
  return found ? { status: found.status as NounFormInfo['status'], plural: found.plural, source: found.source, note: found.note } : { status: 'unknown' }
}
