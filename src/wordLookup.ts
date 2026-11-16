export type WordEntry = {
  id: string
  source: 'deck' | 'starter'
  prompt: string
  meaning: string
  category: string
}

export type WordSource = WordEntry & { plural?: string }
export type MessagePart = { text: string; word: boolean }

const wordPattern = /([\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*)/u
const singleWord = /^[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*$/u

export const normalizeWord = (word: string) => word.normalize('NFC').toLocaleLowerCase('de-DE')

const stripArticle = (value: string) => value.trim().replace(/^(der|die|das)\s+/i, '')

export const splitMessage = (text: string): MessagePart[] =>
  text.split(wordPattern).filter(Boolean).map((part) => ({ text: part, word: singleWord.test(part) }))

// Only exact single-word forms (the headword and a noun's plural) are indexed; no inflections are guessed.
export const indexWords = (entries: WordSource[]) => {
  const index = new Map<string, WordEntry>()
  for (const { plural, ...entry } of entries) {
    for (const form of [entry.prompt, plural]) {
      if (!form) continue
      const word = stripArticle(form)
      if (!singleWord.test(word)) continue
      const key = normalizeWord(word)
      if (!index.has(key)) index.set(key, entry)
    }
  }
  return index
}

export const findWord = (word: string, ...indexes: Map<string, WordEntry>[]) => {
  const key = normalizeWord(word)
  for (const index of indexes) {
    const entry = index.get(key)
    if (entry) return entry
  }
  return null
}
