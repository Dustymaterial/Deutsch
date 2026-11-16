import { normalizeWord, type WordEntry } from './wordLookup.ts'

// [word, part of speech, English gloss, article, plural, example, translation, learner level]
export type DictionaryLemma = [string, string, string, string, string, string, string, string]

export type Dictionary = {
  format: 'deutsch-dictionary'
  version: number
  source: string
  sourceUrl: string
  license: string
  lemmas: DictionaryLemma[]
  forms: Record<string, number | number[]>
}

const maxResults = 3

export const parseDictionary = (value: unknown): Dictionary => {
  const data = value as Partial<Dictionary> | null
  if (!data || data.format !== 'deutsch-dictionary' || !Array.isArray(data.lemmas)
    || !data.forms || typeof data.forms !== 'object') {
    throw new Error('The dictionary file is not in the expected format.')
  }
  return data as Dictionary
}

export const lookupDictionary = (dictionary: Dictionary, word: string): WordEntry[] => {
  const key = normalizeWord(word)
  const found = Object.hasOwn(dictionary.forms, key) ? dictionary.forms[key] : undefined
  if (found === undefined) return []
  const indexes = Array.isArray(found) ? found : [found]
  // An exact headword comes first. Then, as German nouns are capitalised, a capitalised word prefers noun
  // readings and a lowercase one prefers the rest.
  const capitalised = word.charAt(0) !== word.charAt(0).toLocaleLowerCase('de-DE')
  const score = (index: number) => {
    const lemma = dictionary.lemmas[index]
    return (lemma && normalizeWord(lemma[0]) === key ? 2 : 0) + ((lemma?.[1] === 'noun') === capitalised ? 1 : 0)
  }
  const ranked = [...indexes].sort((a, b) => score(b) - score(a))
  return ranked.slice(0, maxResults).flatMap((index) => {
    const lemma = dictionary.lemmas[index]
    if (!lemma) return []
    const [headword, category, meaning, article, plural, example, translation, level] = lemma
    return [{
      id: `dictionary-${index}`,
      source: 'dictionary' as const,
      prompt: article ? `${article} ${headword}` : headword,
      meaning,
      category,
      ...(plural ? { plural: `die ${plural}` } : {}),
      ...(example ? { example } : {}),
      ...(translation ? { translation } : {}),
      ...(level ? { level } : {}),
      ...(normalizeWord(headword) !== key ? { form: word } : {}),
    }]
  })
}

const addableCategories = new Set(['noun', 'verb', 'adjective', 'adverb', 'numeral'])

// Why a dictionary entry cannot become a study card yet, or null when it can.
export const addReason = (entry: WordEntry): string | null => {
  if (entry.source !== 'dictionary') return null
  if (!addableCategories.has(entry.category)) return 'Only nouns, verbs, adjectives, adverbs and numbers can be added to a deck.'
  if (entry.category === 'noun' && !/^(der|die|das) /.test(entry.prompt)) return 'This noun has no known article, so it cannot be added yet.'
  if (!entry.example || !entry.translation) return 'No example sentence is available for this word yet.'
  return null
}
