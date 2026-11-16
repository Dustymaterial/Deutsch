import { useState } from 'react'
import { CopyText } from './CopyText'
import { getSentenceWords } from './sentenceWords'

export function InteractiveExample({ example, translation, onCopy }: {
  example: string
  translation: string
  onCopy: (text: string) => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const words = getSentenceWords(example, translation)

  return (
    <div className="learn-example">
      <span>In a sentence</span>
      {words ? (
        <>
          <CopyText as="strong" text={example} label="Copy German example" onCopy={onCopy}>
            {words.german.map((part, index) => part.match ? (
              <button
                type="button"
                className="sentence-word"
                aria-pressed={selected === part.match}
                key={index}
                onClick={() => setSelected(selected === part.match ? null : part.match ?? null)}
              >{part.text}</button>
            ) : part.text)}
          </CopyText>
          <p lang="en">{words.english.map((part, index) => part.match && selected === part.match
            ? <mark className="sentence-translation-highlight" key={index}>{part.text}</mark>
            : part.text)}</p>
          <small className="sentence-word-hint">Tap an underlined word to see its meaning.</small>
          <span className="sentence-word-announcement" role="status">
            {selected ? `${selected}: ${words.english.find((part) => part.match === selected)?.text}` : ''}
          </span>
        </>
      ) : (
        <>
          <CopyText as="strong" text={example} label="Copy German example" onCopy={onCopy} />
          {translation && <p lang="en">{translation}</p>}
        </>
      )}
    </div>
  )
}
