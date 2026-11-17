import { englishVariants, glossKeys, normalizeWord, type WordEntry } from './wordLookup.ts'

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
    const entry = entryFromLemma(dictionary, index)
    if (!entry) return []
    return [normalizeWord(dictionary.lemmas[index][0]) !== key ? { ...entry, form: word } : entry]
  })
}

function entryFromLemma(dictionary: Dictionary, index: number): WordEntry | null {
  const lemma = dictionary.lemmas[index]
  if (!lemma) return null
  const [headword, category, meaning, article, plural, example, translation, level] = lemma
  return {
    id: `dictionary-${index}`,
    source: 'dictionary',
    prompt: article ? `${article} ${headword}` : headword,
    meaning,
    category,
    ...(plural ? { plural: `die ${plural}` } : {}),
    ...(example ? { example } : {}),
    ...(translation ? { translation } : {}),
    ...(level ? { level } : {}),
  }
}

type EnglishIndex = Map<string, { index: number; position: number }[]>
const englishIndexes = new WeakMap<Dictionary, EnglishIndex>()
const maxEnglishResults = 5

const englishIndexFor = (dictionary: Dictionary) => {
  const cached = englishIndexes.get(dictionary)
  if (cached) return cached
  const index: EnglishIndex = new Map()
  dictionary.lemmas.forEach((lemma, lemmaIndex) => {
    for (const { key, position } of glossKeys(lemma[2])) {
      if (position > 3) continue
      index.set(key, [...(index.get(key) ?? []), { index: lemmaIndex, position }])
    }
  })
  englishIndexes.set(dictionary, index)
  return index
}

// English → German: German words whose English gloss is the given word, best glosses and most frequent words first.
export const lookupEnglish = (dictionary: Dictionary, word: string): WordEntry[] => {
  const index = englishIndexFor(dictionary)
  for (const variant of englishVariants(word)) {
    const hits = index.get(variant)
    if (!hits?.length) continue
    return [...hits]
      .sort((a, b) => a.position - b.position || a.index - b.index)
      .filter((hit, position, all) => all.findIndex((other) => other.index === hit.index) === position)
      .slice(0, maxEnglishResults)
      .flatMap((hit) => {
        const entry = entryFromLemma(dictionary, hit.index)
        return entry ? [{ ...entry, via: word }] : []
      })
  }
  return []
}

const addableCategories = new Set(['noun', 'verb', 'adjective', 'adverb', 'numeral'])

// Dictionary entries are numbered by word frequency (lower is more common); deck and starter words count as very common.
const frequencyRank = (entry: WordEntry) =>
  entry.source === 'dictionary' ? Number(entry.id.split('-')[1]) || 0 : -1

// Which reading of a tapped word to show first. The German reading wins unless the English one is clearly
// more common ("house" is also the rare German noun House), and either can be switched to by hand.
export const preferredLanguage = (german: WordEntry[], english: WordEntry[]): 'de' | 'en' | null => {
  if (!german.length) return english.length ? 'en' : null
  if (!english.length) return 'de'
  return frequencyRank(english[0]) >= 0 && (frequencyRank(german[0]) + 1) / (frequencyRank(english[0]) + 1) > 3 ? 'en' : 'de'
}

// Why a dictionary entry cannot become a study card, or null when it can.
export const addReason = (entry: WordEntry): string | null => {
  if (entry.source !== 'dictionary') return null
  if (!addableCategories.has(entry.category)) return 'Only nouns, verbs, adjectives, adverbs and numbers can be added to a deck.'
  if (entry.category === 'noun' && !/^(der|die|das) /.test(entry.prompt)) return 'This noun has no known article, so it cannot be added yet.'
  return null
}

// Cards need an example sentence; when the dictionary has none the learner writes their own.
export const needsExample = (entry: WordEntry) => entry.source === 'dictionary' && !entry.example
