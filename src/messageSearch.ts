export type MatchSource = {
  kind?: string
  text: string
  card?: { prompt: string; meaning: string; example: string; translation?: string }
  correction?: { text?: string; note?: string }
}

export type Snippet = { before: string; match: string; after: string }

// Case- and accent-insensitive, so "uber" finds "über" and "strasse" is not special-cased.
export const foldText = (value: string) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de-DE')

export const findMatch = (text: string, query: string): [number, number] | null => {
  const needle = foldText(query.trim())
  if (!needle) return null
  let folded = ''
  const starts: number[] = []
  let index = 0
  for (const character of text) {
    const piece = foldText(character)
    for (let position = 0; position < piece.length; position += 1) starts.push(index)
    folded += piece
    index += character.length
  }
  const at = folded.indexOf(needle)
  if (at < 0) return null
  const end = at + needle.length
  return [starts[at], end < starts.length ? starts[end] : text.length]
}

export const searchableFields = (message: MatchSource) => [
  ...(message.card ? [] : [message.text]),
  ...(message.card ? [message.card.prompt, message.card.meaning, message.card.example, message.card.translation ?? ''] : []),
  ...(message.correction ? [message.correction.text ?? '', message.correction.note ?? ''] : []),
].filter(Boolean)

export const matchSnippet = (message: MatchSource, query: string, radius = 48): Snippet | null => {
  for (const field of searchableFields(message)) {
    const range = findMatch(field, query)
    if (!range) continue
    const [start, end] = range
    const from = Math.max(0, start - radius)
    const to = Math.min(field.length, end + radius)
    return {
      before: `${from > 0 ? '…' : ''}${field.slice(from, start)}`,
      match: field.slice(start, end),
      after: `${field.slice(end, to)}${to < field.length ? '…' : ''}`,
    }
  }
  return null
}
