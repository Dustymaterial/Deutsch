import { useState } from 'react'
import { CopyText } from './CopyText'
import { getSentenceWords } from './sentenceWords'
import { splitMessage } from './wordLookup'
import { useWordLookup } from './useWordLookup'
import { ChatWordPeek } from './ChatWordPeek'

export function InteractiveExample({ example, translation, onCopy, variant = 'learn' }: {
  example: string
  translation: string
  onCopy: (text: string) => void
  variant?: 'learn' | 'recall' | 'answer'
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const words = getSentenceWords(example, translation)
  const lookup = useWordLookup(selected)
  const german = splitMessage(example).map((part, index) => part.word ? (
    <button type="button" className="sentence-word" lang="de" key={index}
      aria-pressed={selected === part.text} aria-label={`Look up ${part.text}`}
      onClick={() => { if (!window.getSelection()?.toString()) setSelected(selected === part.text ? null : part.text) }}
    >{part.text}</button>
  ) : part.text)
  const english = words ? words.english.map((part, index) => part.match && selected === part.match
    ? <mark className="sentence-translation-highlight" key={index}>{part.text}</mark>
    : part.text) : translation

  return (
    <div className={variant === 'learn' ? 'learn-example' : variant === 'recall' ? 'fact-row example-row' : 'answer-example'}>
      {variant !== 'answer' && <span className={variant === 'recall' ? 'label' : undefined}>In a sentence</span>}
      {variant === 'answer'
        ? <p className="choice-example" lang="de">{german}</p>
        : <CopyText as="strong" text={example} label="Copy German example" onCopy={onCopy}>{german}</CopyText>}
      {translation && (variant === 'learn'
        ? <p lang="en">{english}</p>
        : <span className={variant === 'recall' ? 'translation' : 'choice-translation'} lang="en">{english}</span>)}
      {selected && <ChatWordPeek key={selected} word={selected} preferGerman german={lookup.german} english={lookup.english}
        loading={lookup.loading} unavailable={lookup.unavailable} onRetry={lookup.retry}
        inDeck={lookup.inDeck} onAdd={lookup.onAdd} onClose={() => setSelected(null)} />}

    </div>
  )
}
