import { validAcceptedAnswers } from './productionQuiz.ts'
import type { Rating, RecallField, ReviewEvent } from './scheduler'
import { isWordActivity, type WordActivity } from './activity.ts'

export type Card = {
  id: string
  prompt: string
  article?: string
  meaning: string
  plural?: string
  acceptedAnswers?: string[]
  example: string
  translation?: string
  category: string
  tags: string[]
  status: 'active' | 'archived'
  dueAt: string
  intervalDays: number
  repetitions: number
  easeFactor: number
  lapses: number
  lastReviewedAt: string | null
  lastRating: Rating | null
  correctCount: number
  incorrectCount: number
  reviewHistory: ReviewEvent[]
  activity?: WordActivity
  reviewResetAt?: string
  firstReviewScheduledAt?: string
  learning?: { saved: boolean; updatedAt: string }
  sharedFrom?: { shareId: string; username: string; sharedAt: string; note?: string }
  createdAt: string
  updatedAt: string
}

export type VocabularyCategory =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'numeral'
  | 'phrase'

export type VocabularyEntry = {
  word: string
  category: VocabularyCategory
  article?: 'der' | 'die' | 'das'
  meaning: string
  plural?: string
  acceptedAnswers?: string[]
  example: string
  translation?: string
  level?: 'A1' | 'A2'
  tags?: string[]
}

export type ParsedDeckImport = {
  cards: Card[]
  kind: 'backup' | 'vocabulary'
}

const isRating = (value: unknown): value is Rating =>
  value === 'again' || value === 'hard' || value === 'good' || value === 'easy'

const isRecallField = (value: unknown): value is RecallField =>
  value === 'article' || value === 'plural' || value === 'meaning' || value === 'context'

const isReviewEvent = (value: unknown): value is ReviewEvent => {
  if (!value || typeof value !== 'object') return false
  const review = value as Partial<ReviewEvent>
  return (
    typeof review.at === 'string' &&
    isRating(review.rating) &&
    Number.isFinite(review.intervalDays) &&
    Number.isFinite(review.easeFactor) &&
    (review.mode === undefined ||
      review.mode === 'recall' ||
      review.mode === 'choice' ||
      review.mode === 'production') &&
    (review.answerCorrect === undefined || typeof review.answerCorrect === 'boolean') &&
    (review.struggledWith === undefined ||
      (Array.isArray(review.struggledWith) && review.struggledWith.every(isRecallField)))
  )
}

export const isDeckCard = (value: unknown): value is Card => {
  if (!value || typeof value !== 'object') return false
  const card = value as Partial<Card>
  return (
    typeof card.id === 'string' &&
    typeof card.prompt === 'string' &&
    (card.article === undefined || typeof card.article === 'string') &&
    typeof card.meaning === 'string' &&
    (card.plural === undefined || typeof card.plural === 'string') &&
    (card.acceptedAnswers === undefined || validAcceptedAnswers(card.acceptedAnswers, card.category ?? '')) &&
    typeof card.example === 'string' &&
    (card.translation === undefined || typeof card.translation === 'string') &&
    typeof card.category === 'string' &&
    Array.isArray(card.tags) &&
    card.tags.every((tag) => typeof tag === 'string') &&
    (card.status === 'active' || card.status === 'archived') &&
    typeof card.dueAt === 'string' &&
    Number.isFinite(Date.parse(card.dueAt)) &&
    Number.isFinite(card.intervalDays) &&
    Number.isFinite(card.repetitions) &&
    Number.isFinite(card.easeFactor) &&
    Number.isFinite(card.lapses) &&
    Number.isFinite(card.correctCount) &&
    Number.isFinite(card.incorrectCount) &&
    (card.reviewResetAt === undefined ||
      (typeof card.reviewResetAt === 'string' && Number.isFinite(Date.parse(card.reviewResetAt)))) &&
    (card.firstReviewScheduledAt === undefined ||
      (typeof card.firstReviewScheduledAt === 'string' && Number.isFinite(Date.parse(card.firstReviewScheduledAt)))) &&
    (card.lastReviewedAt === null ||
      (typeof card.lastReviewedAt === 'string' && Number.isFinite(Date.parse(card.lastReviewedAt)))) &&
    (card.lastRating === null || isRating(card.lastRating)) &&
    (card.learning === undefined ||
      (typeof card.learning === 'object' && card.learning !== null &&
        typeof card.learning.saved === 'boolean' &&
        typeof card.learning.updatedAt === 'string' &&
        Number.isFinite(Date.parse(card.learning.updatedAt)))) &&
    (card.sharedFrom === undefined ||
      (typeof card.sharedFrom === 'object' && card.sharedFrom !== null &&
        typeof card.sharedFrom.shareId === 'string' &&
        typeof card.sharedFrom.username === 'string' &&
        typeof card.sharedFrom.sharedAt === 'string' &&
        Number.isFinite(Date.parse(card.sharedFrom.sharedAt)) &&
        (card.sharedFrom.note === undefined || (typeof card.sharedFrom.note === 'string' && card.sharedFrom.note.length <= 240)))) &&
    Array.isArray(card.reviewHistory) &&
    card.reviewHistory.every(isReviewEvent) &&
    (card.activity === undefined || isWordActivity(card.activity))
  )
}

const isVocabularyEntry = (value: unknown): value is VocabularyEntry => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<VocabularyEntry>
  return (
    typeof entry.word === 'string' &&
    entry.word.trim().length > 0 &&
    (entry.category === 'noun' ||
      entry.category === 'verb' ||
      entry.category === 'adjective' ||
      entry.category === 'adverb' ||
      entry.category === 'numeral' ||
      entry.category === 'phrase') &&
    (entry.article === undefined ||
      entry.article === 'der' ||
      entry.article === 'die' ||
      entry.article === 'das') &&
    (entry.category !== 'noun' || entry.article !== undefined) &&
    (entry.category === 'noun' ||
      (entry.article === undefined && entry.plural === undefined)) &&
    typeof entry.meaning === 'string' &&
    entry.meaning.trim().length > 0 &&
    (entry.plural === undefined || typeof entry.plural === 'string') &&
    (entry.acceptedAnswers === undefined || validAcceptedAnswers(entry.acceptedAnswers, entry.category ?? '')) &&
    typeof entry.example === 'string' &&
    entry.example.trim().length > 0 &&
    (entry.translation === undefined || typeof entry.translation === 'string') &&
    (entry.level === undefined || entry.level === 'A1' || entry.level === 'A2') &&
    (entry.tags === undefined ||
      (Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === 'string')))
  )
}

export const normalizeDeckCard = (card: Card): Card => ({
  ...card,
  translation: card.translation ?? '',
  ...(card.category === 'verb' && card.article === 'verb'
    ? { article: undefined, plural: undefined }
    : {}),
})

const stableId = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `vocab-${(hash >>> 0).toString(36)}`
}

const fromVocabularyEntry = (entry: VocabularyEntry, now: Date): Card => {
  const timestamp = now.toISOString()
  const word = entry.word.trim()
  const article = entry.category === 'noun' ? entry.article : undefined
  const prompt = article && !word.toLocaleLowerCase('de-DE').startsWith(`${article} `)
    ? `${article} ${word}`
    : word
  const contentKey = [entry.category, article ?? '', prompt, entry.meaning.trim()]
    .join('|')
    .toLocaleLowerCase('de-DE')

  return {
    id: stableId(contentKey),
    prompt,
    ...(article ? { article } : {}),
    meaning: entry.meaning.trim(),
    ...(entry.plural?.trim() ? { plural: entry.plural.trim() } : {}),
    ...(entry.acceptedAnswers?.length ? { acceptedAnswers: entry.acceptedAnswers.map((answer) => answer.trim()) } : {}),
    example: entry.example.trim(),
    translation: entry.translation?.trim() ?? '',
    category: entry.category,
    tags: [...new Set([entry.level ?? 'A1', entry.category, ...(entry.tags ?? [])])],
    status: 'active',
    dueAt: timestamp,
    intervalDays: 0,
    repetitions: 0,
    easeFactor: 2.5,
    lapses: 0,
    lastReviewedAt: null,
    lastRating: null,
    correctCount: 0,
    incorrectCount: 0,
    reviewHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export const cardContentKey = (card: Card) =>
  [card.category, card.article ?? '', card.prompt, card.meaning]
    .join('|')
    .trim()
    .toLocaleLowerCase('de-DE')

export const parseDeckImport = (value: unknown, now = new Date()): ParsedDeckImport => {
  let items: unknown
  let kind: ParsedDeckImport['kind'] | null = null

  if (Array.isArray(value)) {
    items = value
  } else if (value && typeof value === 'object' && 'format' in value && 'version' in value && 'cards' in value) {
    const data = value as { format: unknown; version: unknown; cards: unknown }
    if (data.version !== 1 || !Array.isArray(data.cards)) {
      throw new Error('Unsupported or invalid deck file version.')
    }
    if (data.format === 'deutsch-daily-deck') kind = 'backup'
    else if (data.format === 'deutsch-vocabulary') kind = 'vocabulary'
    else throw new Error('Unrecognized deck file format.')
    items = data.cards
  } else {
    throw new Error('Choose a Deutsch deck backup or vocabulary JSON file.')
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('The selected file does not contain any cards.')
  }

  if (items.every(isDeckCard)) {
    if (kind === 'vocabulary') {
      throw new Error('Vocabulary template files must contain simple word entries.')
    }
    return { cards: items.map(normalizeDeckCard), kind: 'backup' }
  }

  if (items.every(isVocabularyEntry)) {
    if (kind === 'backup') {
      throw new Error('Deck backups must contain review history and scheduler state.')
    }
    return { cards: items.map((entry) => fromVocabularyEntry(entry, now)), kind: 'vocabulary' }
  }

  throw new Error(
    'Some entries are incomplete or invalid. Check the vocabulary template for required fields.',
  )
}

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }

    if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim().length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  if (quoted) throw new Error('The CSV has an unfinished quoted field.')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim().length > 0)) rows.push(row)
  }
  return rows
}

export const parseVocabularyCsv = (text: string): VocabularyEntry[] => {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one word.')

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  if (new Set(headers).size !== headers.length) {
    throw new Error('The CSV contains duplicate column names.')
  }

  const requiredHeaders = ['word', 'category', 'meaning', 'example']
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header))
  if (missingHeaders.length) {
    throw new Error(`The CSV is missing required columns: ${missingHeaders.join(', ')}.`)
  }

  const allowedHeaders = new Set([
    ...requiredHeaders,
    'article',
    'plural',
    'acceptedanswers',
    'translation',
    'level',
    'tags',
  ])
  const unsupportedHeaders = headers.filter((header) => !allowedHeaders.has(header))
  if (unsupportedHeaders.length) {
    throw new Error(`Unknown CSV columns: ${unsupportedHeaders.join(', ')}.`)
  }

  const entries = rows.slice(1).map((cells, rowIndex) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${cells.length} cells; expected ${headers.length}.`)
    }

    const get = (name: string) => {
      const column = headers.indexOf(name)
      return column === -1 ? '' : cells[column].trim()
    }
    const tags = get('tags')
      .split('|')
      .map((tag) => tag.trim())
      .filter(Boolean)

    return {
      word: get('word'),
      category: get('category').toLowerCase(),
      article: get('article').toLowerCase() || undefined,
      meaning: get('meaning'),
      plural: get('plural') || undefined,
      acceptedAnswers: get('acceptedanswers') ? get('acceptedanswers').split('|').map((answer) => answer.trim()).filter(Boolean) : undefined,
      example: get('example'),
      translation: get('translation') || undefined,
      level: get('level').toUpperCase() || undefined,
      tags: tags.length ? tags : undefined,
    }
  })

  const validEntries: VocabularyEntry[] = []
  for (const entry of entries) {
    if (!isVocabularyEntry(entry)) {
      throw new Error(
        'A CSV word is incomplete or invalid. Nouns need der/die/das; check the template and row values.',
      )
    }
    validEntries.push(entry)
  }

  return validEntries
}

export const parseDeckFile = (
  text: string,
  filename: string,
  now = new Date(),
): ParsedDeckImport => {
  if (filename.toLowerCase().endsWith('.csv')) {
    return parseDeckImport(parseVocabularyCsv(text), now)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON. Use a .json backup/template or a .csv vocabulary file.')
  }
  return parseDeckImport(parsed, now)
}
