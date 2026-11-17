import { ChatWordPeek } from './ChatWordPeek'
import { normalizeWord, splitMessage, type WordEntry } from './wordLookup'

export type MessageWordTools = {
  activeWord: { messageId: string; key: string; word: string } | null
  wordChipsFor: string | null
  pickWord: (messageId: string, word: string) => void
  isKnown: (word: string) => boolean
  german: WordEntry[]
  english: WordEntry[]
  loading: boolean
  unavailable: boolean
  inDeck: (entry: WordEntry) => boolean
  onAdd: (entry: WordEntry) => void
  onClose: () => void
  toggleChips: (messageId: string) => void
}

export function MessageWords({ id, text, tools }: { id: string; text: string; tools: MessageWordTools }) {
  return <>
    <p className="companion-message-text" onClick={(event) => {
      if (!(event.target instanceof Element) || window.getSelection()?.toString()) return
      const target = event.target.closest<HTMLElement>('[data-word]')
      if (target?.dataset.word) tools.pickWord(id, target.dataset.word)
    }}>{splitMessage(text).map((part, index) => {
      if (!part.word) return part.text
      const key = normalizeWord(part.text)
      const open = tools.activeWord?.messageId === id && tools.activeWord.key === key
      return <span className={`companion-word${tools.isKnown(part.text) ? ' known' : ''}${open ? ' active' : ''}`} key={index} data-word={part.text}>{part.text}</span>
    })}</p>
    {tools.wordChipsFor === id && <div className="companion-word-chips" role="group" aria-label="Look up a word from this message">
      {[...new Map(splitMessage(text).filter((part) => part.word).map((part) => [normalizeWord(part.text), part.text])).values()].map((word) => <button key={word} type="button" lang="de" aria-pressed={tools.activeWord?.messageId === id && tools.activeWord.key === normalizeWord(word)} onClick={() => tools.pickWord(id, word)}>{word}</button>)}
    </div>}
    {tools.activeWord?.messageId === id && <ChatWordPeek
      key={`${id}-${tools.activeWord.key}`}
      word={tools.activeWord.word}
      german={tools.german}
      english={tools.english}
      loading={tools.loading}
      unavailable={tools.unavailable}
      inDeck={tools.inDeck}
      onAdd={tools.onAdd}
      onClose={tools.onClose}
    />}
  </>
}
