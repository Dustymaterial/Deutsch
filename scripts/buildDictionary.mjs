import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { downloadKaikki } from './kaikkiDownload.mjs'

// Builds the lazily loaded German word-form dictionary used for tap-to-translate in companion chat.
//
// Entries and inflections come from the German entries of English Wiktionary, as extracted by
// Wiktextract and published by Kaikki.org (CC BY-SA 4.0 and GFDL). Word frequency, used only to decide
// which words to keep and how to rank them, comes from the pinned slovymovy/words German frequency list.
const FREQUENCY_REVISION = 'bbef653dc3737361949403c36c822cda61cff512'
const FREQUENCY_URL = `https://raw.githubusercontent.com/slovymovy/words/${FREQUENCY_REVISION}/freqs/de_kaikki_words.txt`
const OUTPUT_PATH = resolve('src/data/german-dictionary.json')
const CACHE_DIR = process.env.DICTIONARY_CACHE_DIR ?? join(tmpdir(), 'deutsch-dictionary-cache')
const MAX_RANK = Number(process.env.DICTIONARY_MAX_RANK ?? 30000)
const EXAMPLE_RANK = Number(process.env.DICTIONARY_EXAMPLE_RANK ?? MAX_RANK)
const MAX_GLOSS_LENGTH = 90
const MAX_GLOSSES = 4
const MAX_EXAMPLE_LENGTH = 140

const POS_ALIASES = {
  noun: 'noun',
  verb: 'verb',
  adj: 'adjective',
  adv: 'adverb',
  num: 'numeral',
  prep: 'preposition',
  contraction: 'contraction',
  conj: 'conjunction',
  pron: 'pronoun',
  det: 'determiner',
  article: 'determiner',
  particle: 'particle',
  intj: 'interjection',
}
const GENDER_ARTICLES = { masculine: 'der', feminine: 'die', neuter: 'das' }
const SKIPPED_SENSE_TAGS = new Set(['form-of', 'alt-of', 'obsolete', 'archaic', 'historical', 'misspelling', 'nonstandard'])
const SKIPPED_FORM_TAGS = new Set([
  'auxiliary', 'table-tags', 'inflection-template', 'class', 'multiword-construction', 'romanization',
  'diminutive', 'alternative', 'obsolete',
])
const WORD_PATTERN = /^[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*$/u
const PREFIX_PATTERN = /^(?:ich|du|er\/sie\/es|er|sie|es|wir|ihr|der|die|das|den|dem|des|ein|eine|einen|einem|eines|einer|am)\s+/iu
const ALTERNATIVE_GLOSS = /^(?:alternative|obsolete|superseded|nonstandard|dated|eye dialect)\b.*\b(?:of|for)\b/iu
const closedClass = new Set(['pronoun', 'determiner', 'numeral'])

const formKey = (token) => token.normalize('NFC').toLocaleLowerCase('de-DE')

const cachedText = async (name, url) => {
  await mkdir(CACHE_DIR, { recursive: true })
  const file = join(CACHE_DIR, name)
  const existing = await stat(file).catch(() => null)
  if (existing?.size) return readFile(file, 'utf8')
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`)
  const text = await response.text()
  await writeFile(file, text)
  return text
}

// Include source-backed vocabulary used by our own examples, even outside the frequency cut.
const starter = JSON.parse(await readFile(resolve('src/data/german-starter-pack.json'), 'utf8'))
const requiredWords = new Set(starter.cards.flatMap((card) =>
  [...card.example.matchAll(/[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*/gu)].map((match) => formKey(match[0])),
))
const requiredAliases = new Map()

const frequencyText = await cachedText(`frequency-${FREQUENCY_REVISION.slice(0, 8)}.txt`, FREQUENCY_URL)
const ranks = new Map()
frequencyText.split(/\r?\n/).slice(1).forEach((row, index) => {
  const key = formKey(row.split('\t', 1)[0].trim())
  if (key && !ranks.has(key)) ranks.set(key, index + 1)
})

const cleanGloss = (gloss) => gloss.replace(/\s+/g, ' ').replace(/[.;:\s]+$/u, '').trim()
// Wiktionary glosses carry long clarifications in brackets; the short core is what a learner needs.
const tidyGloss = (gloss) => cleanGloss(cleanGloss(gloss).replace(/\s*\([^()]*\)/gu, '')) || cleanGloss(gloss)
const GRAMMAR_GLOSS = /^(?:forms|used (?:to|as|in|with|for)|expresses|indicates|as a|introduces)\b/iu
const glossItems = (sense) => tidyGloss(sense.glosses.at(-1)).split(/\s*;\s*/u).filter(Boolean)

const formToken = (form) => {
  if (typeof form.form !== 'string') return null
  if (form.tags?.some((tag) => SKIPPED_FORM_TAGS.has(tag))) return null
  let value = form.form.trim().replace(/[!?.,;:]+$/u, '')
  if (/[()/…]/u.test(value.replace(/^er\/sie\/es\s+/iu, ''))) return null
  value = value.replace(PREFIX_PATTERN, '')
  return WORD_PATTERN.test(value) ? value : null
}

const pluralOf = (forms) => {
  for (const form of forms) {
    const tags = form.tags ?? []
    if (!tags.includes('plural') || tags.some((tag) => ['diminutive', 'genitive', 'dative', 'accusative', 'table-tags'].includes(tag))) continue
    const value = (form.form ?? '').replace(/^(?:der|die|das)\s+/iu, '').trim()
    if (WORD_PATTERN.test(value)) return value
  }
  return ''
}

const keptSenses = (entry) => (entry.senses ?? []).filter((sense) =>
  Array.isArray(sense.glosses) && sense.glosses.length
  && !sense.form_of && (!sense.alt_of || entry.pos === 'contraction')
  && !sense.tags?.some((tag) => SKIPPED_SENSE_TAGS.has(tag) && !(entry.pos === 'contraction' && tag === 'alt-of'))
  && !ALTERNATIVE_GLOSS.test(sense.glosses.at(-1)))

const pickExample = (senses) => {
  for (const sense of senses) {
    for (const example of sense.examples ?? []) {
      const text = cleanGloss(example.text ?? '')
      const translation = cleanGloss(example.english ?? example.translation ?? '')
      if (text && translation && text.length <= MAX_EXAMPLE_LENGTH && translation.length <= MAX_EXAMPLE_LENGTH) {
        return { text: /[.!?]$/u.test(text) ? text : text, translation }
      }
    }
  }
  return null
}

// Gather every kept entry per word and part of speech (Wiktionary splits some words by etymology).
const groups = new Map()
const input = createReadStream(await downloadKaikki().then((result) => result.path), { encoding: 'utf8' })
let lines = 0
for await (const line of createInterface({ input, crlfDelay: Infinity })) {
  lines += 1
  const posMatch = /^\{"pos": "([^"]+)"/u.exec(line)
  const pos = posMatch ? POS_ALIASES[posMatch[1]] : undefined
  if (!pos) continue
  const entry = JSON.parse(line)
  const word = entry.word
  if (typeof word !== 'string' || !WORD_PATTERN.test(word) || word.length > 60) continue
  // Hyphenated spellings such as "E-Mail" are ranked by how often people write them without the hyphen.
  const rank = Math.min(ranks.get(formKey(word)) ?? Infinity, ranks.get(formKey(word).replaceAll('-', '')) ?? Infinity)
  if (requiredWords.has(formKey(word))) {
    const bases = (entry.senses ?? []).flatMap((sense) => sense.form_of ?? []).map((item) => item.word)
    if (bases.length) requiredAliases.set(formKey(word), [...new Set([...(requiredAliases.get(formKey(word)) ?? []), ...bases])])
  }
  if (rank > MAX_RANK && !requiredWords.has(formKey(word))) continue
  const senses = keptSenses(entry)
  if (!senses.length) continue
  const key = `${pos}|${word}`
  const group = groups.get(key) ?? { pos, word, rank, senses: [], forms: [], heads: [] }
  group.heads.push(entry.head_templates?.[0]?.expansion ?? '')
  group.senses.push(...senses)
  group.forms.push(...(entry.forms ?? []))
  groups.set(key, group)
}
// A required surface form can refer to an uncommon lemma outside the frequency cut.
// Resolve that source reference in a second pass rather than inventing a stem.
const extraBases = new Set([...requiredAliases.values()].flat().map(formKey))
for (const group of groups.values()) extraBases.delete(formKey(group.word))
if (extraBases.size) {
  const source = createReadStream(await downloadKaikki().then((result) => result.path), { encoding: 'utf8' })
  for await (const line of createInterface({ input: source, crlfDelay: Infinity })) {
    const entry = JSON.parse(line)
    if (!extraBases.has(formKey(entry.word ?? ''))) continue
    const pos = POS_ALIASES[entry.pos]
    if (!pos || !WORD_PATTERN.test(entry.word)) continue
    const senses = keptSenses(entry)
    if (!senses.length) continue
    const id = `${pos}|${entry.word}`
    const group = groups.get(id) ?? { pos, word: entry.word, rank: Infinity, senses: [], forms: [], heads: [] }
    group.heads.push(entry.head_templates?.[0]?.expansion ?? '')
    group.senses.push(...senses)
    group.forms.push(...(entry.forms ?? []))
    groups.set(id, group)
  }
}
console.log(`Read ${lines} source entries; kept ${groups.size} words at or above rank ${MAX_RANK}.`)

const lemmas = []
const headwords = new Map()
const inflections = new Map()
const closedInflections = new Map()
const lemmaForms = []
const addTo = (map, token, index) => {
  const key = formKey(token)
  const current = map.get(key) ?? []
  if (!current.includes(index)) map.set(key, [...current, index])
}

const posCounts = {}
const ordered = [...groups.values()].sort((a, b) => a.rank - b.rank || a.pos.localeCompare(b.pos) || a.word.localeCompare(b.word, 'de'))
for (const { pos, word, rank, senses, forms, heads } of ordered) {
  const candidates = []
  for (const sense of senses) {
    for (const item of glossItems(sense)) {
      if (!candidates.some((existing) => existing.toLowerCase() === item.toLowerCase())) candidates.push(item)
    }
  }
  // Short, plain meanings first; grammar notes only when nothing else is available.
  const plain = candidates.filter((item) => !GRAMMAR_GLOSS.test(item))
  const ranked = [...(plain.length ? plain : candidates)]
    .map((item, position) => ({ item, position, long: item.length > 45 ? 1 : 0 }))
    .sort((a, b) => a.long - b.long || a.position - b.position)
    .map(({ item }) => item)
  let gloss = ''
  let count = 0
  for (const item of ranked) {
    const next = gloss ? `${gloss}; ${item}` : item
    if (gloss && (count >= MAX_GLOSSES || next.length > MAX_GLOSS_LENGTH)) continue
    gloss = next.length > MAX_GLOSS_LENGTH ? `${next.slice(0, MAX_GLOSS_LENGTH - 1).replace(/\s+\S*$/u, '')}…` : next
    count += 1
  }
  if (!gloss) continue

  // Wiktionary's headword line lists the main gender first ("Joghurt (predominant) m or n"); regional
  // variants only appear in the sense tags, so they are the fallback.
  const headGender = pos === 'noun'
    ? heads.map((head) => /^\S+\s+([mfn])(?=\s|$)/u.exec(head.replace(/\s*\([^()]*\)/gu, ''))?.[1]).find(Boolean)
    : undefined
  const tagGender = senses.flatMap((sense) => sense.tags ?? []).find((tag) => Object.hasOwn(GENDER_ARTICLES, tag))
  const article = pos === 'noun'
    ? ({ m: 'der', f: 'die', n: 'das' }[headGender] ?? (tagGender ? GENDER_ARTICLES[tagGender] : ''))
    : ''
  const plural = pos === 'noun' ? pluralOf(forms) : ''
  const example = rank <= EXAMPLE_RANK ? pickExample(senses) : null
  const index = lemmas.length
  posCounts[pos] = (posCounts[pos] ?? 0) + 1
  lemmas.push([word, pos, gloss, article, plural, example?.text ?? '', example?.translation ?? '', ''])
  addTo(headwords, word, index)
  if (word.includes('-')) addTo(inflections, word.replaceAll('-', ''), index)
  lemmaForms[index] = new Set()
  for (const token of new Set(forms.map(formToken).filter(Boolean))) {
    addTo(closedClass.has(pos) ? closedInflections : inflections, token, index)
    lemmaForms[index].add(formKey(token))
  }
}

// A few source headwords are really an inflected form of a more basic word of the same kind that
// escaped the form-of flag (for example "kleiner" for "klein"); the base word's table covers them.
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

// Pronoun, numeral and determiner tables list unrelated common words (for example "sein" or
// "zwei"), so they never override another word's own headword or inflection.
const forms = new Map()
const merge = (key, indexes) => forms.set(key, [...new Set([...(forms.get(key) ?? []), ...indexes])])
for (const [key, indexes] of reindex(headwords)) merge(key, indexes)
for (const [key, indexes] of reindex(inflections)) merge(key, indexes)
const keptHeadwords = reindex(headwords)
for (const [alias, bases] of requiredAliases) {
  for (const base of bases) {
    const indexes = keptHeadwords.get(formKey(base))
    if (indexes) merge(alias, indexes)
  }
}
for (const [key, indexes] of reindex(closedInflections)) {
  if (!forms.has(key)) merge(key, indexes)
}
for (const [key, indexes] of forms) forms.set(key, indexes.length === 1 ? indexes[0] : [...indexes].sort((a, b) => a - b))

const { lastModified } = await downloadKaikki()
const requiredCoverage = [...requiredWords].filter((word) => !forms.has(word))
const output = {
  coverage: { exampleTokens: requiredWords.size, dictionaryMatches: requiredWords.size - requiredCoverage.length, missing: requiredCoverage },
  format: 'deutsch-dictionary',
  version: 1,
  source: 'English Wiktionary (German entries) as extracted by Wiktextract and published by Kaikki.org',
  sourceUrl: 'https://kaikki.org/dictionary/German/',
  sourceDate: lastModified,
  frequencySource: `slovymovy/words German frequency list at revision ${FREQUENCY_REVISION}`,
  license: 'CC BY-SA 4.0',
  modified: `Reduced to the ${keptLemmas.length} most frequent single-word German entries (frequency rank ${MAX_RANK} or better, plus source-backed words and form-of links required by starter examples) that have an English gloss; inflected-form entries and obsolete, archaic and historical senses are left out. Keeps up to ${MAX_GLOSSES} short English glosses, noun article and plural, one example sentence with its English translation where Wiktionary has one, and single-word inflected forms for tap-to-translate lookup. Field order: word, part of speech, English gloss, article, plural, example, translation, learner level (unused).`,
  lemmas: keptLemmas,
  forms: Object.fromEntries([...forms.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'))),
}
await mkdir(dirname(OUTPUT_PATH), { recursive: true })
await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`)
console.log(`Dropped ${dropped.size} entries that are inflected forms of another word.`)
console.log(`Wrote ${keptLemmas.length} words and ${forms.size} word forms to ${OUTPUT_PATH}`)
console.log(posCounts)
const uncovered = [...requiredWords].filter((word) => !forms.has(word))
console.log(`Starter example coverage: ${requiredWords.size - uncovered.length}/${requiredWords.size}; uncovered: ${uncovered.join(', ')}`)
