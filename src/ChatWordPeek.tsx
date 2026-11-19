import { useState } from 'react'
import { MenuSelect } from './MenuSelect'
import { ChevronDown } from 'lucide-react'
import { addReason, needsExample, preferredLanguage } from './dictionaryLookup'
import type { WordEntry } from './wordLookup'

type Props = {
  word: string
  german: WordEntry[]
  english: WordEntry[]
  loading: boolean
  unavailable: boolean
  inDeck: (entry: WordEntry) => boolean
  onAdd: (entry: WordEntry) => void
  onClose: () => void
  onRetry?: () => void
  allowAdd?: boolean
  preferGerman?: boolean
}

const categoryLabel = (category: string) => category.charAt(0).toUpperCase() + category.slice(1)

function AddControl({ entry, inDeck, onAdd }: { entry: WordEntry; inDeck: boolean; onAdd: (entry: WordEntry) => void }) {
  const [writing, setWriting] = useState(false)
  const [example, setExample] = useState('')
  const [translation, setTranslation] = useState('')
  const reason = addReason(entry)
  if (inDeck) return <span className="companion-word-peek-status">In your deck</span>
  if (reason) return <small>{reason}</small>
  if (!writing) {
    return <button className="companion-word-peek-add" type="button" onClick={() => needsExample(entry) ? setWriting(true) : onAdd(entry)}>Add to deck</button>
  }
  return (
    <form className="companion-word-peek-example-form" onSubmit={(event) => {
      event.preventDefault()
      if (example.trim()) onAdd({ ...entry, example: example.trim(), translation: translation.trim() })
    }}>
      <label>Write a German sentence using it
        <input lang="de" value={example} maxLength={240} onChange={(event) => setExample(event.target.value)} placeholder="Ich lerne jeden Tag Deutsch." autoFocus />
      </label>
      <label>English meaning of your sentence (optional)
        <input value={translation} maxLength={240} onChange={(event) => setTranslation(event.target.value)} />
      </label>
      <div>
        <button type="submit" disabled={!example.trim()}>Add to deck</button>
        <button type="button" onClick={() => setWriting(false)}>Cancel</button>
      </div>
    </form>
  )
}

export function ChatWordPeek({ word, german, english, loading, unavailable, inDeck, onAdd, onClose, onRetry, allowAdd = true, preferGerman = false }: Props) {
  const [choice, setChoice] = useState<'de' | 'en' | null>(null)
  const mode = choice ?? (preferGerman ? german.length ? 'de' : null : preferredLanguage(german, english))
  const [sense, setSense] = useState(0)
  const entry = german[sense] ?? german[0]
  const lookups = [
    { label: 'Wiktionary', href: `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}` },
    { label: 'dict.cc', href: `https://www.dict.cc/?s=${encodeURIComponent(word)}` },
  ]
  const usesDictionary = [...german, ...english].some((item) => item.source === 'dictionary')

  const both = german.length > 0 && english.length > 0
  const heading = mode === 'de' && entry && !both
    ? <div className="companion-word-peek-head">
      <strong lang="de">{entry.prompt}</strong>
      <em>{categoryLabel(entry.category)}</em>
      {entry.level && <em className="level">{entry.level}</em>}
    </div>
    : null

  return (
    <div className="companion-word-peek" role="status">
      <div className="companion-word-peek-top">
        {both
          ? <div className="companion-word-peek-modes" role="group" aria-label="Which language is this word?">
            <button type="button" aria-pressed={mode === 'de'} onClick={() => setChoice('de')}>German word</button>
            <button type="button" aria-pressed={mode === 'en'} onClick={() => setChoice('en')}>English word</button>
          </div>
          : heading ?? <small>{mode === 'en' ? `“${word}” in German` : `“${word}”`}</small>}
        <button className="companion-word-peek-close" type="button" aria-label="Collapse translation" title="Collapse" onClick={onClose}><ChevronDown size={16} aria-hidden="true" /></button>
      </div>
      {mode === 'de' && german.length > 1 && <label className="lookup-sense-label">Meaning
        <MenuSelect value={String(sense)} ariaLabel="Choose a meaning" onChange={(value) => setSense(Number(value))}
          options={german.map((item, index) => ({ value: String(index), label: `${item.prompt}: ${item.meaning}` }))} />
      </label>}
      {mode === 'de' && entry && <>
        {both && <div className="companion-word-peek-head">
          <strong lang="de">{entry.prompt}</strong>
          <em>{categoryLabel(entry.category)}</em>
          {entry.level && <em className="level">{entry.level}</em>}
        </div>}
        {entry.form && <small>“{entry.form}” is a form of <span lang="de">{entry.prompt}</span></small>}
        <p className="companion-word-peek-meaning">{entry.meaning}</p>
        {entry.plural && <small>Plural: <span lang="de">{entry.plural}</span></small>}
        {entry.example && <p className="companion-word-peek-example" lang="de">{entry.example}</p>}
        {entry.translation && <p className="companion-word-peek-translation">{entry.translation}</p>}

        {allowAdd && <div className="companion-word-peek-actions"><AddControl key={entry.id} entry={entry} inDeck={inDeck(entry)} onAdd={onAdd} /></div>}
      </>}
      {mode === 'en' && english.length > 0 && <>
        <ul className="companion-word-peek-list">
          {english.map((item) => <li key={`${item.id}-${item.category}`}>
            <div className="companion-word-peek-head">
              <strong lang="de">{item.prompt}</strong>
              <em>{categoryLabel(item.category)}</em>
            </div>
            <p className="companion-word-peek-meaning">{item.meaning}</p>
            {item.example && <p className="companion-word-peek-example" lang="de">{item.example}</p>}
            {item.translation && <p className="companion-word-peek-translation">{item.translation}</p>}
            {allowAdd && <div className="companion-word-peek-actions"><AddControl entry={item} inDeck={inDeck(item)} onAdd={onAdd} /></div>}
          </li>)}
        </ul>
      </>}
      {!mode && (loading
        ? <p className="companion-word-peek-meaning">Looking up “{word}”…</p>
        : <>
          <p className="companion-word-peek-meaning">
            {unavailable ? 'The dictionary could not be loaded. ' : `No match for “${word}” in your deck or the dictionary. `}
            It may be a name, a compound word, a spelling variant, or a word the dictionary does not cover yet.
          </p>
          <div className="companion-word-peek-actions">
            {lookups.map((lookup) => <a key={lookup.label} className="companion-word-peek-link" href={lookup.href} target="_blank" rel="noopener noreferrer">Look up on {lookup.label}</a>)}
          </div>
        </>)}
      {unavailable && onRetry && <button type="button" className="quiet-button" onClick={onRetry}>Retry lookup</button>}
      {usesDictionary && <small className="companion-word-peek-source">
        Dictionary: <a href="https://kaikki.org/dictionary/German/" target="_blank" rel="noopener noreferrer">English Wiktionary, via Kaikki.org</a> · CC BY-SA 4.0
      </small>}
    </div>
  )
}
