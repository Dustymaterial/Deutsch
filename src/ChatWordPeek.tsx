import { useState } from 'react'
import { X } from 'lucide-react'
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

export function ChatWordPeek({ word, german, english, loading, unavailable, inDeck, onAdd, onClose }: Props) {
  const [choice, setChoice] = useState<'de' | 'en' | null>(null)
  const mode = choice ?? preferredLanguage(german, english)
  const [entry, ...rest] = german
  // Only other kinds of word are worth listing (noun vs verb); more verbs sharing a form are just noise.
  const others = rest.filter((item, index) => item.category !== entry?.category
    && rest.findIndex((other) => other.category === item.category) === index)
  const lookups = [
    { label: 'Wiktionary', href: `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}` },
    { label: 'dict.cc', href: `https://www.dict.cc/?s=${encodeURIComponent(word)}` },
  ]
  const usesDictionary = [...german, ...english].some((item) => item.source === 'dictionary')

  return (
    <div className="companion-word-peek" role="status">
      <button className="companion-word-peek-close" type="button" aria-label="Close translation" onClick={onClose}><X size={13} aria-hidden="true" /></button>
      {german.length > 0 && english.length > 0 && <div className="companion-word-peek-modes" role="group" aria-label="Which language is this word?">
        <button type="button" aria-pressed={mode === 'de'} onClick={() => setChoice('de')}>German word</button>
        <button type="button" aria-pressed={mode === 'en'} onClick={() => setChoice('en')}>English word</button>
      </div>}
      {mode === 'de' && entry && <>
        <div className="companion-word-peek-head">
          <strong lang="de">{entry.prompt}</strong>
          <em>{categoryLabel(entry.category)}</em>
          {entry.level && <em className="level">{entry.level}</em>}
        </div>
        {entry.form && <small>“{entry.form}” is a form of <span lang="de">{entry.prompt}</span></small>}
        <p className="companion-word-peek-meaning">{entry.meaning}</p>
        {entry.plural && <small>Plural: <span lang="de">{entry.plural}</span></small>}
        {entry.example && <p className="companion-word-peek-example" lang="de">{entry.example}</p>}
        {entry.translation && <p className="companion-word-peek-translation">{entry.translation}</p>}
        {others.length > 0 && <small>Also: {others.map((item) => `${item.prompt} (${item.meaning})`).join(' · ')}</small>}
        <div className="companion-word-peek-actions"><AddControl entry={entry} inDeck={inDeck(entry)} onAdd={onAdd} /></div>
      </>}
      {mode === 'en' && english.length > 0 && <>
        <small>“{word}” in German</small>
        <ul className="companion-word-peek-list">
          {english.map((item) => <li key={`${item.id}-${item.category}`}>
            <div className="companion-word-peek-head">
              <strong lang="de">{item.prompt}</strong>
              <em>{categoryLabel(item.category)}</em>
            </div>
            <p className="companion-word-peek-meaning">{item.meaning}</p>
            {item.example && <p className="companion-word-peek-example" lang="de">{item.example}</p>}
            {item.translation && <p className="companion-word-peek-translation">{item.translation}</p>}
            <div className="companion-word-peek-actions"><AddControl entry={item} inDeck={inDeck(item)} onAdd={onAdd} /></div>
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
      {usesDictionary && <small className="companion-word-peek-source">
        Meanings from <a href="https://kaikki.org/dictionary/German/" target="_blank" rel="noopener noreferrer">English Wiktionary, via Kaikki.org</a> · CC BY-SA 4.0
      </small>}
    </div>
  )
}
