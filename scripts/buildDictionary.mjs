import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Builds the lazily loaded German word-form dictionary used for tap-to-translate in companion chat.
// Source data: slovymovy/words (derived from Wiktionary, Kaikki.org and Wiktextract), CC BY-SA 4.0.
const SOURCE_REVISION = 'bbef653dc3737361949403c36c822cda61cff512'
const BASE_URL = `https://raw.githubusercontent.com/slovymovy/words/${SOURCE_REVISION}`
const OUTPUT_PATH = resolve('src/data/german-dictionary.json')
const CACHE_DIR = process.env.DICTIONARY_CACHE_DIR ?? join(tmpdir(), 'deutsch-dictionary-cache')
const CANDIDATE_LIMIT = Number(process.env.DICTIONARY_CANDIDATES ?? 15000)
const WORKERS = 24
const MAX_GLOSS_LENGTH = 90
const MAX_EXAMPLE_LENGTH = 140
const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

const POS_ALIASES = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adjective: 'adjective',
  adv: 'adverb',
  adverb: 'adverb',
  num: 'numeral',
  numeral: 'numeral',
  prep: 'preposition',
  preposition: 'preposition',
  conj: 'conjunction',
  conjunction: 'conjunction',
  pron: 'pronoun',
  pronoun: 'pronoun',
  det: 'determiner',
  determiner: 'determiner',
  article: 'determiner',
  particle: 'particle',
  intj: 'interjection',
  interjection: 'interjection',
}
const ARTICLE_BY_GENDER = { masculine: 'der', feminine: 'die', neuter: 'das' }
const CASE_TAGS = new Set(['nominative', 'genitive', 'dative', 'accusative'])
const SKIPPED_FORM_TAGS = new Set([
  'auxiliary', 'table-tags', 'inflection-template', 'class', 'multiword-construction', 'romanization',
])
const WORD_PATTERN = /^[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*$/u
const PREFIX_PATTERN = /^(?:ich|du|er\/sie\/es|er|sie|es|wir|ihr|der|die|das|den|dem|des|ein|eine|einen|einem|eines|einer|am)\s+/iu

const normalizePos = (value) => POS_ALIASES[String(value ?? '').toLowerCase()] ?? null

const cleanText = (value) =>
  String(value ?? '')
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

const cachePath = (path) => join(CACHE_DIR, `${createHash('sha1').update(path).digest('hex')}.json`)

const fetchWithRetry = async (path, parse) => {
  const url = `${BASE_URL}/${path.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (response.status === 404) return null
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) throw new Error(`HTTP ${response.status}`)
        throw new Error(`Could not download ${url}: HTTP ${response.status}`)
      }
      return await parse(response)
    } catch (error) {
      if (attempt === 3) throw new Error(`Failed to download ${url}: ${error.message}`, { cause: error })
      await new Promise((done) => setTimeout(done, 250 * 2 ** attempt))
    }
  }
  return null
}

// Cached so an interrupted build resumes instead of downloading everything again.
const fetchJsonCached = async (path) => {
  const file = cachePath(path)
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    // Not cached yet.
  }
  const data = await fetchWithRetry(path, (response) => response.json())
  await writeFile(file, JSON.stringify(data))
  return data
}

const mapWithLimit = async (items, limit, worker) => {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await worker(items[index], index)
    }
  }))
  return results
}

const formToken = (form) => {
  if (typeof form.form !== 'string') return null
  if (form.tags?.some((tag) => SKIPPED_FORM_TAGS.has(tag))) return null
  let value = form.form.trim().replace(/[!?.,;:]+$/u, '')
  if (/[()/…]/u.test(value.replace(/^er\/sie\/es\s+/iu, ''))) return null
  value = value.replace(PREFIX_PATTERN, '')
  return WORD_PATTERN.test(value) ? value : null
}

const nounDetails = (entries) => {
  const genders = new Set(entries.flatMap((entry) => (entry.senses ?? []).flatMap((sense) =>
    (sense.tags ?? []).filter((tag) => Object.hasOwn(ARTICLE_BY_GENDER, tag)))))
  if (genders.size !== 1) return {}
  const gender = [...genders][0]
  const forms = entries
    .filter((entry) => entry.senses?.some((sense) => sense.tags?.includes(gender)))
    .flatMap((entry) => entry.forms ?? [])
  const plurals = forms.filter((form) => form.tags?.includes('plural')
    && !form.tags.some((tag) => CASE_TAGS.has(tag)))
  const nominativePlurals = forms.filter((form) => form.tags?.includes('plural')
    && form.tags.includes('nominative')
    && !form.tags.some((tag) => ['genitive', 'dative', 'accusative'].includes(tag)))
  const bases = [...new Set((plurals.length ? plurals : nominativePlurals)
    .map((form) => form.form.replace(/^(der|die|das)\s+/iu, '').trim())
    .filter((value) => WORD_PATTERN.test(value)))]
  return { article: ARTICLE_BY_GENDER[gender], ...(bases.length === 1 ? { plural: bases[0] } : {}) }
}

const pickExample = (senses) => {
  const candidates = senses.flatMap((sense) => (sense.examples ?? []).map((example) => ({
    text: cleanText(example.text),
    translation: cleanText(example.target_lang_translations?.en),
    level: sense.learner_level,
  }))).filter((item) => item.text && item.translation
    && item.text.length <= MAX_EXAMPLE_LENGTH && item.translation.length <= MAX_EXAMPLE_LENGTH)
  const rank = (level) => (LEVEL_ORDER.includes(level) ? LEVEL_ORDER.indexOf(level) : LEVEL_ORDER.length)
  return candidates.sort((a, b) => rank(a.level) - rank(b.level))[0] ?? null
}

const pickGloss = (senses) => {
  const words = []
  for (const sense of senses) {
    for (const item of sense.translations?.en ?? []) {
      const word = cleanText(item.target_lang_word)
      if (word && !words.some((existing) => existing.toLowerCase() === word.toLowerCase())) words.push(word)
    }
  }
  let gloss = ''
  for (const word of words.slice(0, 4)) {
    const next = gloss ? `${gloss}; ${word}` : word
    if (next.length > MAX_GLOSS_LENGTH) break
    gloss = next
  }
  return gloss
}

await mkdir(CACHE_DIR, { recursive: true })
const frequencyText = await fetchWithRetry('freqs/de_kaikki_words.txt', (response) => response.text())
if (!frequencyText) throw new Error('The source German frequency list could not be downloaded.')
const candidates = [...new Set(frequencyText.split(/\r?\n/).slice(1)
  .map((row) => row.split('\t', 1)[0].trim())
  .filter((word) => /^[\p{L}]{2,30}$/u.test(word)))].slice(0, CANDIDATE_LIMIT)
console.log(`Looking up ${candidates.length} candidate words…`)

let completed = 0
const records = await mapWithLimit(candidates, WORKERS, async (word) => {
  const wordData = await fetchJsonCached(`words/de/${word}.json`)
  completed += 1
  if (completed % 500 === 0) console.log(`${completed}/${candidates.length}`)
  if (!Array.isArray(wordData?.entries) || !wordData.entries.length) return null
  const extract = await fetchJsonCached(`db-extract/de/${word}.json`)
  return { word, wordData, extract }
})

const lemmas = []
const lemmaIndex = new Map()
const headwords = new Map()
const inflections = new Map()
const closedInflections = new Map()
const lemmaForms = []
const closedClass = new Set(['pronoun', 'determiner', 'numeral'])
const formKey = (token) => token.normalize('NFC').toLocaleLowerCase('de-DE')
const addTo = (map, token, index) => {
  const key = formKey(token)
  const current = map.get(key) ?? []
  if (!current.includes(index)) map.set(key, [...current, index])
}

const posCounts = {}
for (const record of records) {
  if (!record) continue
  const { word, wordData, extract } = record
  const extractEntries = Object.values(extract?.source_file_to_entries ?? {}).flat()
    .filter((entry) => entry.lang_code === 'de' && entry.word?.toLocaleLowerCase('de-DE') === word.toLocaleLowerCase('de-DE'))
  const byPos = new Map()
  for (const entry of wordData.entries) {
    const pos = normalizePos(entry.pos)
    if (!pos) continue
    byPos.set(pos, [...(byPos.get(pos) ?? []), ...(entry.senses ?? [])])
  }
  for (const [pos, senses] of byPos) {
    const gloss = pickGloss(senses)
    if (!gloss) continue
    const matching = extractEntries.filter((entry) => normalizePos(entry.pos) === pos)
    // Inflected words such as "habe" or "kleiner" have their own source entries; their meaning is
    // reached through the base word's inflection table instead of becoming separate headwords.
    const inflectedOnly = matching.length > 0 && matching.every((entry) =>
      (entry.senses ?? []).length > 0 && entry.senses.every((sense) => sense.tags?.includes('form-of')))
    if (inflectedOnly) continue
    const display = matching.find((entry) => entry.word)?.word
      ?? (pos === 'noun' ? `${word[0].toLocaleUpperCase('de-DE')}${word.slice(1)}` : word)
    const key = `${pos}|${display}`
    if (lemmaIndex.has(key)) continue
    const details = pos === 'noun' ? nounDetails(matching) : {}
    const example = pickExample(senses)
    const levels = senses.map((sense) => sense.learner_level).filter((level) => LEVEL_ORDER.includes(level))
    const level = levels.sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b))[0] ?? ''
    const index = lemmas.length
    lemmaIndex.set(key, index)
    posCounts[pos] = (posCounts[pos] ?? 0) + 1
    lemmas.push([
      display, pos, gloss, details.article ?? '', details.plural ?? '',
      example?.text ?? '', example?.translation ?? '', level,
    ])
    addTo(headwords, display, index)
    lemmaForms[index] = new Set()
    for (const entry of matching) {
      for (const form of entry.forms ?? []) {
        const token = formToken(form)
        if (!token) continue
        addTo(closedClass.has(pos) ? closedInflections : inflections, token, index)
        lemmaForms[index].add(formKey(token))
      }
    }
  }
}

// Some source headwords are really an inflected form of a more basic word of the same kind
// (for example "kleiner" for "klein"). Keep only the base word; its table already covers them.
const sharedPrefix = (a, b) => {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1
  return length
}
const dropped = new Set()
for (let index = 0; index < lemmas.length; index += 1) {
  const key = formKey(lemmas[index][0])
  for (const baseIndex of inflections.get(key) ?? []) {
    // Only a more frequent base word can absorb this entry; compounds listing "gehen" must not.
    if (baseIndex >= index || lemmas[baseIndex][1] !== lemmas[index][1]) continue
    if (formKey(lemmas[baseIndex][0]) === key || lemmaForms[index].has(formKey(lemmas[baseIndex][0]))) continue
    // The two words must share a stem ("kleiner"/"klein"); "werden" listing the auxiliary "sein" does not count.
    if (sharedPrefix(key, formKey(lemmas[baseIndex][0])) < 3) continue
    dropped.add(index)
    break
  }
}
const remap = new Map()
const keptLemmas = []
lemmas.forEach((lemma, index) => {
  if (dropped.has(index)) return
  remap.set(index, keptLemmas.length)
  keptLemmas.push(lemma)
})
const reindex = (map) => new Map([...map].map(([key, indexes]) => [
  key,
  indexes.filter((index) => remap.has(index)).map((index) => remap.get(index)),
]).filter(([, indexes]) => indexes.length))
const headwordsKept = reindex(headwords)
const inflectionsKept = reindex(inflections)
const closedKept = reindex(closedInflections)

// Pronoun, numeral and determiner tables list unrelated common words (for example "sein" or
// "zwei"), so they never override another word's own headword or inflection.
const forms = new Map()
const merge = (key, indexes) => forms.set(key, [...new Set([...(forms.get(key) ?? []), ...indexes])])
for (const [key, indexes] of headwordsKept) merge(key, indexes)
for (const [key, indexes] of inflectionsKept) merge(key, indexes)
for (const [key, indexes] of closedKept) {
  if (!forms.has(key)) merge(key, indexes)
}
for (const [key, indexes] of forms) forms.set(key, indexes.length === 1 ? indexes[0] : [...indexes].sort((a, b) => a - b))

const output = {
  format: 'deutsch-dictionary',
  version: 1,
  source: 'slovymovy/words, derived from Wiktionary, Kaikki.org, and Wiktextract',
  sourceUrl: `https://github.com/slovymovy/words/tree/${SOURCE_REVISION}`,
  sourceRevision: SOURCE_REVISION,
  license: 'CC BY-SA 4.0',
  modified: `Reduced to the ${candidates.length} most frequent source German words that have an English meaning; keeps a short English gloss, noun article and plural, one example sentence with translation, and inflected single-word forms for tap-to-translate lookup. Field order: word, part of speech, English gloss, article, plural, example, translation, learner level.`,
  lemmas: keptLemmas,
  forms: Object.fromEntries([...forms.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'))),
}
await mkdir(dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`)
console.log(`Dropped ${dropped.size} entries that are inflected forms of another word.`)
console.log(`Wrote ${keptLemmas.length} words and ${forms.size} word forms to ${OUTPUT_PATH}`)
console.log(posCounts)
