import type { Card } from './deckImport'

export type Recording = {
  url: string
  source: string
  author: string
  license?: string
  licenseUrl?: string
  modified?: boolean
}

const recordings: Record<string, Recording> = {
  Haus: { url: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/De-Haus.ogg', source: 'https://commons.wikimedia.org/wiki/File:De-Haus.ogg', author: 'Kampy' },
  Gesundheit: { url: 'https://upload.wikimedia.org/wikipedia/commons/c/c0/De-Gesundheit.ogg', source: 'https://commons.wikimedia.org/wiki/File:De-Gesundheit.ogg', author: 'Kampy' },
  Wasser: { url: 'https://upload.wikimedia.org/wikipedia/commons/7/75/De-Wasser.ogg', source: 'https://commons.wikimedia.org/wiki/File:De-Wasser.ogg', author: 'Tosca' },
  Buch: { url: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/De-Buch.ogg', source: 'https://commons.wikimedia.org/wiki/File:De-Buch.ogg', author: 'Tosca' },
  Familie: { url: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/De-Familie.ogg', source: 'https://commons.wikimedia.org/wiki/File:De-Familie.ogg', author: 'T.Voekler' },
}

export const getRecording = (card: Card, catalogue?: Record<string, Recording>): Recording | undefined => {
  const word = card.article && card.prompt.startsWith(`${card.article} `)
    ? card.prompt.slice(card.article.length + 1)
    : card.prompt
  return catalogue?.[word.normalize('NFC').trim().toLocaleLowerCase('de-DE')] ?? (card.category === 'noun' ? recordings[word] : undefined)
}

export const loadPronunciations = async (): Promise<Record<string, Recording>> =>
  (await import('./data/german-pronunciation.json')).default.entries
