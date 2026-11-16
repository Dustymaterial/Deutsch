import { useState } from 'react'
import { CopyText } from './CopyText'
import { getSentenceWords } from './sentenceWords'

export function InteractiveExample({ example, translation, onCopy, variant = 'learn' }: {
  example: string
  translation: string
  onCopy: (text: string) => void
  variant?: 'learn' | 'recall' | 'answer'
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const words = getSentenceWords(example, translation)
  const german = words ? words.german.map((part, index) => part.match ? (
    <button
      type="button"
      className="sentence-word"
      aria-pressed={selected === part.match}
      key={index}
      onClick={() => setSelected(selected === part.match ? null : part.match ?? null)}
    >{part.text}</button>
  ) : part.text) : example
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
      {words ? (
        <>
          <small className="sentence-word-hint">Tap an underlined word to see its meaning.</small>
          <span className="sentence-word-announcement" role="status">
            {selected ? `${selected}: ${words.english.find((part) => part.match === selected)?.text}` : ''}
          </span>
        </>
      ) : null}
    </div>
  )
}
