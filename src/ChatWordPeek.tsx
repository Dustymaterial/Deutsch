import { X } from 'lucide-react'
import type { WordEntry } from './wordLookup'

type Props = {
  word: string
  entries: WordEntry[]
  loading: boolean
  unavailable: boolean
  inDeck: boolean
  addReason: string | null
  onAdd: (entry: WordEntry) => void
  onClose: () => void
}

const categoryLabel = (category: string) => category.charAt(0).toUpperCase() + category.slice(1)

export function ChatWordPeek({ word, entries, loading, unavailable, inDeck, addReason, onAdd, onClose }: Props) {
  const [entry, ...rest] = entries
  // Only other kinds of word are worth listing (noun vs verb); more verbs sharing a form are just noise.
  const others = rest.filter((item, index) => item.category !== entry?.category
    && rest.findIndex((other) => other.category === item.category) === index)
  const wiktionary = `https://de.wiktionary.org/wiki/${encodeURIComponent(word)}`

  return (
    <div className="companion-word-peek" role="status">
      <button className="companion-word-peek-close" type="button" aria-label="Close translation" onClick={onClose}><X size={13} aria-hidden="true" /></button>
      {entry ? <>
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
        <div className="companion-word-peek-actions">
          {inDeck
            ? <span className="companion-word-peek-status">In your deck</span>
            : addReason
              ? <small>{addReason}</small>
              : <button className="companion-word-peek-add" type="button" onClick={() => onAdd(entry)}>Add to deck</button>}
        </div>
        {entry.source === 'dictionary' && <small className="companion-word-peek-source">
          Meaning from <a href="https://github.com/slovymovy/words" target="_blank" rel="noopener noreferrer">Wiktionary-based open data</a> · CC BY-SA 4.0
        </small>}
      </> : loading
        ? <p className="companion-word-peek-meaning">Looking up “{word}”…</p>
        : <>
          <p className="companion-word-peek-meaning">
            {unavailable ? 'The dictionary could not be loaded. ' : `No match for “${word}” in your deck or the dictionary. `}
            It may be a name, a compound word or a spelling variant.
          </p>
          <div className="companion-word-peek-actions">
            <a className="companion-word-peek-link" href={wiktionary} target="_blank" rel="noopener noreferrer">Look up on Wiktionary</a>
          </div>
        </>}
    </div>
  )
}
