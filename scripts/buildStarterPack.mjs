import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SOURCE_REVISION = 'bbef653dc3737361949403c36c822cda61cff512'
const BASE_URL = `https://raw.githubusercontent.com/slovymovy/words/${SOURCE_REVISION}`
const OUTPUT_PATH = resolve('src/data/german-starter-pack.json')
const WORKERS = 16
const CORE_WORD_LIMIT = 3000
const CORE_TOPIC = 'Core vocabulary'
const TOPICS = [
  { file: 'at_the_doctor', tag: 'Health' },
  { file: 'clothes_and_accessories', tag: 'Clothes' },
  { file: 'cooking', tag: 'Food' },
  { file: 'emotions', tag: 'Feelings' },
  { file: 'family', tag: 'Family' },
  { file: 'nature', tag: 'Nature' },
  { file: 'numbers_and_time', tag: 'Time and numbers' },
  { file: 'school', tag: 'School' },
  { file: 'travel', tag: 'Travel' },
  { file: 'work_and_career', tag: 'Work' },
]
const CATEGORY_BY_PART_OF_SPEECH = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  numeral: 'numeral',
}
const ARTICLE_BY_GENDER = {
  masculine: 'der',
  feminine: 'die',
  neuter: 'das',
}
const CASE_TAGS = new Set(['nominative', 'genitive', 'dative', 'accusative'])

const mapWithLimit = async (items, limit, worker) => {
  const results = new Array(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

const fetchJson = async (path) => {
  const url = `${BASE_URL}/${path.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.status === 404) return null
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}`)
        }
        throw new Error(`Could not download ${url}: HTTP ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Failed to download ${url}: ${error.message}`, { cause: error })
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * 2 ** attempt))
    }
  }
  return null
}

const fetchText = async (path) => {
  const url = `${BASE_URL}/${path.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.status === 404) return null
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`HTTP ${response.status}`)
        }
        throw new Error(`Could not download ${url}: HTTP ${response.status}`)
      }
      return await response.text()
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Failed to download ${url}: ${error.message}`, { cause: error })
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * 2 ** attempt))
    }
  }
  return null
}

const cleanText = (value) =>
  value
    .replace(/<\/?w>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getNounDetails = (data, word) => {
  const entries = Object.values(data?.source_file_to_entries ?? {})
    .flat()
    .filter((entry) => entry.lang_code === 'de' && entry.pos === 'noun')
  const genderEntries = entries.filter((entry) =>
    entry.senses?.some((sense) =>
      sense.tags?.some((tag) => Object.hasOwn(ARTICLE_BY_GENDER, tag)),
    ),
  )
  const genders = new Set(
    genderEntries.flatMap((entry) =>
      entry.senses.flatMap((sense) =>
        sense.tags.filter((tag) => Object.hasOwn(ARTICLE_BY_GENDER, tag)),
      ),
    ),
  )

  if (genders.size === 1) {
    const gender = [...genders][0]
    const formEntries = genderEntries.filter((entry) =>
      entry.senses.some((sense) => sense.tags?.includes(gender)),
    )
    const forms = formEntries.flatMap((entry) => entry.forms ?? [])
    const simplePluralForms = forms.filter((form) =>
      form.tags?.includes('plural') &&
      !form.tags.some((tag) => CASE_TAGS.has(tag)),
    )
    const nominativePluralForms = forms.filter((form) =>
      form.tags?.includes('plural') &&
      form.tags?.includes('nominative') &&
      !form.tags.some((tag) => ['genitive', 'dative', 'accusative'].includes(tag)),
    )
    const pluralSources = simplePluralForms.length ? simplePluralForms : nominativePluralForms
    const pluralBases = [...new Set(
      pluralSources
        .map((form) => form.form.replace(/^(der|die|das)\s+/i, '').trim())
        .filter(Boolean),
    )]

    return {
      article: ARTICLE_BY_GENDER[gender],
      ...(pluralBases.length === 1 ? { plural: `die ${pluralBases[0]}` } : {}),
    }
  }

  const pluralOnly = genders.size === 0 && entries.some((entry) =>
    entry.senses?.some((sense) => sense.tags?.includes('plural')),
  )
  if (pluralOnly) return { article: 'die', plural: `die ${word}` }
  return null
}

const getVocabularyEntry = (lemma, reference, wordData, nounData) => {
  const senseMatches = (wordData?.entries ?? []).flatMap((entry) =>
    (entry.senses ?? [])
      .filter((sense) => sense.sense_id === reference.senseId)
      .map((sense) => ({ entry, sense })),
  )
  const match = senseMatches.find(({ entry, sense }) =>
    CATEGORY_BY_PART_OF_SPEECH[entry.pos] &&
    (sense.learner_level === 'A1' || sense.learner_level === 'A2'),
  )
  if (!match) return null

  const { entry, sense } = match
  const category = CATEGORY_BY_PART_OF_SPEECH[entry.pos]
  const translations = sense.translations?.en ?? []
  const meaning = cleanText(
    translations.find((item) => item.target_lang_word)?.target_lang_word ??
      sense.target_lang_definitions?.en ??
      '',
  )
  const example = (sense.examples ?? []).find((item) =>
    typeof item.text === 'string' &&
    typeof item.target_lang_translations?.en === 'string',
  )
  if (!meaning || !example) return null

  const sourceWord = entry.word || lemma
  const word = category === 'noun'
    ? `${sourceWord[0].toLocaleUpperCase('de-DE')}${sourceWord.slice(1)}`
    : sourceWord
  const germanExample = cleanText(example.text)
  const englishExample = cleanText(example.target_lang_translations.en)
  if (
    word.length > 100 ||
    meaning.length > 160 ||
    germanExample.length > 240 ||
    englishExample.length > 240
  ) {
    return null
  }

  const nounDetails = category === 'noun' ? getNounDetails(nounData, word) : {}
  if (category === 'noun' && !nounDetails) return null

  return {
    word,
    category,
    ...(nounDetails.article ? { article: nounDetails.article } : {}),
    meaning,
    ...(nounDetails.plural ? { plural: nounDetails.plural } : {}),
    example: germanExample,
    translation: englishExample,
    level: sense.learner_level,
    tags: ['Open starter', sense.learner_level, reference.topic, category],
  }
}

const sourceLists = await Promise.all(
  TOPICS.map(async ({ file, tag }) => ({
    file,
    tag,
    data: await fetchJson(`lists/de/${file}.json`),
  })),
)

const referencesByLemma = new Map()
for (const { tag, data } of sourceLists) {
  if (!Array.isArray(data?.senses)) {
    throw new Error(`The source topic list did not contain senses: ${tag}`)
  }
  for (const sense of data.senses) {
    const references = referencesByLemma.get(sense.lemma) ?? []
    if (!references.some((item) => item.senseId === sense.senseId && item.topic === tag)) {
      references.push({ senseId: sense.senseId, topic: tag })
    }
    referencesByLemma.set(sense.lemma, references)
  }
}

const frequencyData = await fetchText('freqs/de_kaikki_words.txt')
if (!frequencyData) throw new Error('The source German frequency list could not be downloaded.')
const coreLemmas = [...new Set(
  frequencyData
    .split(/\r?\n/)
    .slice(1)
    .map((row) => row.split('\t', 1)[0].trim().toLocaleLowerCase('de-DE'))
    .filter((word) => /^[a-zäöüß]{2,40}$/u.test(word)),
)].slice(0, CORE_WORD_LIMIT)

const lemmas = [...new Set([...referencesByLemma.keys(), ...coreLemmas])]
const wordResults = await mapWithLimit(lemmas, WORKERS, async (lemma) => ({
  lemma,
  data: await fetchJson(`words/de/${lemma}.json`),
}))
const wordDataByLemma = new Map(wordResults.map(({ lemma, data }) => [lemma, data]))

for (const lemma of coreLemmas) {
  const wordData = wordDataByLemma.get(lemma)
  for (const entry of wordData?.entries ?? []) {
    if (!CATEGORY_BY_PART_OF_SPEECH[entry.pos]) continue
    for (const sense of entry.senses ?? []) {
      if (
        !sense.sense_id ||
        (sense.learner_level !== 'A1' && sense.learner_level !== 'A2')
      ) {
        continue
      }
      const references = referencesByLemma.get(lemma) ?? []
      if (!references.some((item) =>
        item.senseId === sense.sense_id && item.topic === CORE_TOPIC,
      )) {
        references.push({ senseId: sense.sense_id, topic: CORE_TOPIC })
      }
      referencesByLemma.set(lemma, references)
    }
  }
}

const nounLemmas = new Set()
for (const [lemma, references] of referencesByLemma) {
  const wordData = wordDataByLemma.get(lemma)
  if (!wordData) continue
  for (const reference of references) {
    const sense = wordData.entries
      ?.flatMap((entry) => entry.senses ?? [])
      .find((item) => item.sense_id === reference.senseId)
    if (sense?.learner_level === 'A1' || sense?.learner_level === 'A2') {
      if (wordData.entries.some((entry) =>
        entry.pos === 'noun' && entry.senses?.some((item) => item.sense_id === reference.senseId),
      )) {
        nounLemmas.add(lemma)
      }
    }
  }
}

const nounResults = await mapWithLimit([...nounLemmas], WORKERS, async (lemma) => ({
  lemma,
  data: await fetchJson(`db-extract/de/${lemma}.json`),
}))
const nounDataByLemma = new Map(nounResults.map(({ lemma, data }) => [lemma, data]))

const cardsByKey = new Map()
for (const [lemma, references] of referencesByLemma) {
  const wordData = wordDataByLemma.get(lemma)
  for (const reference of references) {
    const entry = getVocabularyEntry(
      lemma,
      reference,
      wordData,
      nounDataByLemma.get(lemma),
    )
    if (!entry || !entry.example || !entry.translation) continue

    const prompt = entry.article ? `${entry.article} ${entry.word}` : entry.word
    const key = [entry.category, entry.article ?? '', prompt, entry.meaning]
      .join('|')
      .toLocaleLowerCase('de-DE')
    const existing = cardsByKey.get(key)
    if (existing) {
      existing.tags = [...new Set([...existing.tags, ...entry.tags])]
      continue
    }

    const id = createHash('sha256')
      .update(key)
      .digest('hex')
      .slice(0, 20)
    cardsByKey.set(key, { id: `open-${id}`, ...entry })
  }
}

const cards = [...cardsByKey.values()]
if (cards.length < 300) {
  throw new Error(`Only ${cards.length} quality-checked starter cards were found; at least 300 are required.`)
}

const output = {
  format: 'deutsch-vocabulary',
  version: 1,
  source: 'slovymovy/words, derived from Wiktionary, Kaikki.org, and Wiktextract',
  sourceUrl: `https://github.com/slovymovy/words/tree/${SOURCE_REVISION}`,
  sourceRevision: SOURCE_REVISION,
  license: 'CC BY-SA 4.0',
  modified: `Filtered to source-labelled A1/A2 entries with English meanings and translated examples. In addition to ten topical lists, selected candidates from the first ${CORE_WORD_LIMIT} unique alphabetic terms in the source German frequency list; normalized noun capitalization, deduplicated entries, and converted to the app vocabulary format with topic tags.`,
  sourceFiles: [
    ...TOPICS.map(({ file }) => `lists/de/${file}.json`),
    'freqs/de_kaikki_words.txt',
  ],
  cards,
}

await mkdir(dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`)

const byLevel = Object.groupBy(cards, (card) => card.level)
const byTopic = Object.fromEntries(
  [...TOPICS.map(({ tag }) => tag), CORE_TOPIC].map((tag) => [
    tag,
    cards.filter((card) => card.tags.includes(tag)).length,
  ]),
)
console.log(`Wrote ${cards.length} cards to ${OUTPUT_PATH}`)
console.log(`Frequency candidates selected: ${coreLemmas.length}`)
console.log(`By level: ${Object.entries(byLevel).map(([level, items]) => `${level}: ${items.length}`).join(', ')}`)
console.log(`By topic: ${Object.entries(byTopic).map(([topic, count]) => `${topic}: ${count}`).join(', ')}`)
