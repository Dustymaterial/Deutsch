import { findWords, indexWords, normalizeWord, stripArticle, type WordEntry } from './wordLookup.ts'
import { lookupDictionary, type Dictionary } from './dictionaryLookup.ts'

export const distinctWordSenses = (entries: WordEntry[], limit = 12) => entries.filter((entry, index, all) =>
  all.findIndex((other) => normalizeWord(other.prompt) === normalizeWord(entry.prompt)
    && other.category === entry.category && normalizeWord(other.meaning) === normalizeWord(entry.meaning)) === index,
).slice(0, limit)

export const germanLookup = (word: string, personal: WordEntry[], starter: WordEntry[], dictionary: Dictionary | null) => {
  const own = indexWords(personal)
  const initial = indexWords(starter)
  const readings = dictionary ? lookupDictionary(dictionary, word) : []
  const fromLemmas = (index: ReturnType<typeof indexWords>) => readings.flatMap((reading) =>
    findWords(stripArticle(reading.prompt), index).filter((entry) => entry.category === reading.category)
      .map((entry) => ({ ...entry, form: word })),
  )
  return distinctWordSenses([
    ...findWords(word, own), ...fromLemmas(own),
    ...findWords(word, initial), ...fromLemmas(initial), ...readings,
  ])
}
