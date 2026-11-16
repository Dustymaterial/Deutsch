const example = 'Regelmäßige Bewegung und gesundes Essen sind sehr wichtig für die eigene Gesundheit.'
const translation = "Regular exercise and healthy food are very important for one's own health."

const pairs: Record<string, string> = {
  Regelmäßige: 'Regular',
  Bewegung: 'exercise',
  und: 'and',
  gesundes: 'healthy',
  Essen: 'food',
  sind: 'are',
  sehr: 'very',
  wichtig: 'important',
  für: 'for',
  eigene: 'own',
  Gesundheit: 'health',
}

export type SentencePart = { text: string; match?: string }

const splitWords = (text: string, matches: Record<string, string>): SentencePart[] =>
  text.split(/([\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*)/u)
    .filter(Boolean)
    .map((part) => ({ text: part, ...(matches[part] ? { match: matches[part] } : {}) }))

export const getSentenceWords = (german: string, english: string) => {
  if (german !== example || english !== translation) return null
  const reversePairs = Object.fromEntries(
    Object.entries(pairs).map(([word, meaning]) => [meaning, word]),
  )
  return {
    german: splitWords(german, Object.fromEntries(Object.keys(pairs).map((word) => [word, word]))),
    english: splitWords(english, reversePairs),
  }
}
