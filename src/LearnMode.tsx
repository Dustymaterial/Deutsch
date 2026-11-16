import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from './deckImport'
import { getStudySetChoiceOptions } from './choiceQuiz'
import { getStudySetTags } from './studySets'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { isUnintroduced } from './scheduler'
import { MenuSelect } from './MenuSelect'
import { containsFloatingTarget } from './floatingTarget'
import { CopyText } from './CopyText'
import { InteractiveExample } from './InteractiveExample'
import { WordAudio } from './WordAudio'
import { emptyLearnHistory, moveLearnHistory, visitLearnWord } from './learnNavigation'
import './LearnMode.css'

type Props = {
  cards: Card[]
  initialTag: string
  dailyLimitReached: boolean
  canSave: boolean
  savingError: string | null
  settingsOpen: boolean
  onCloseSettings: (restoreFocus?: boolean) => void
  onSave: (id: string) => void
  onSchedule: (id: string, beyondLimit: boolean) => boolean
  onCopy: (text: string) => void
}

export default function LearnMode({ cards, initialTag, dailyLimitReached, canSave, savingError, settingsOpen, onCloseSettings, onSave, onSchedule, onCopy }: Props) {
  const [topic, setTopic] = useState(initialTag === 'A1' || initialTag === 'A2' ? '' : initialTag)
  const [level, setLevel] = useState(initialTag === 'A1' || initialTag === 'A2' ? initialTag : '')
  const [view, setView] = useState<'guided' | 'browse' | 'saved'>('guided')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState(emptyLearnHistory)
  const [skipped, setSkipped] = useState<string[]>([])
  const [choice, setChoice] = useState<string | null>(null)
  const [showQuiz, setShowQuiz] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [noOtherSavedWord, setNoOtherSavedWord] = useState(false)
  const [audioVersion, setAudioVersion] = useState(0)
  const settingsRef = useRef<HTMLElement>(null)
  const tags = useMemo(() => getStudySetTags(cards), [cards])
  const scoped = useMemo(() => cards.filter((card) =>
    card.status === 'active' && isUnintroduced(card) &&
    (!topic || card.tags.includes(topic)) && (!level || card.tags.includes(level)),
  ), [cards, topic, level])
  const visible = useMemo(() => scoped.filter((card) => {
    if (view === 'saved' && !card.learning?.saved) return false
    if (view === 'guided' && skipped.includes(card.id)) return false
    const text = query.trim().toLocaleLowerCase()
    return !text || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(text)
  }), [scoped, view, skipped, query])
  const historicalCard = history.ids[history.index] === selectedId
    ? cards.find((item) => item.id === selectedId && item.status === 'active' &&
      (!topic || item.tags.includes(topic)) && (!level || item.tags.includes(level)))
    : undefined
  const card = historicalCard ?? visible.find((item) => item.id === selectedId) ?? visible[0]
  const availableHistory = new Set(cards.filter((item) =>
    item.status === 'active' && (!topic || item.tags.includes(topic)) && (!level || item.tags.includes(level)),
  ).map((item) => item.id))
  const currentHistory = card ? visitLearnWord(history, card.id) : history
  const previousHistory = moveLearnHistory(currentHistory, -1, availableHistory)
  const readOnly = card ? !isUnintroduced(card) : false
  const choices = card ? getStudySetChoiceOptions(card, scoped, cards, 0) : null
  const showNoOtherSavedWord = noOtherSavedWord && card && !visible.some((item) => item.id !== card.id)

  useEffect(() => {
    if (!settingsOpen) return
    settingsRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseSettings(true)
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containsFloatingTarget(settingsRef.current, event.target)) onCloseSettings()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [settingsOpen, onCloseSettings])

  const resetActivity = () => {
    setChoice(null)
    setShowQuiz(false)
    setShowReview(false)
    setNoOtherSavedWord(false)
    setAudioVersion((version) => version + 1)
  }

  const resetNavigation = () => {
    setSelectedId(null)
    setHistory(emptyLearnHistory())
    resetActivity()
  }

  const previous = () => {
    if (!previousHistory) return
    setHistory(previousHistory)
    setSelectedId(previousHistory.ids[previousHistory.index])
    resetActivity()
  }

  const changeView = (nextView: 'guided' | 'browse' | 'saved') => {
    setView(nextView)
    setQuery('')
    resetNavigation()
  }

  const next = (removeCurrent = false, notifyWhenAlone = false) => {
    if (!card) return
    const forwardAvailable = new Set(availableHistory)
    if (removeCurrent) forwardAvailable.delete(card.id)
    const forward = moveLearnHistory(currentHistory, 1, forwardAvailable)
    if (forward) {
      setHistory(forward)
      setSelectedId(forward.ids[forward.index])
      resetActivity()
      return
    }
    const index = visible.findIndex((item) => item.id === card.id)
    const ordered = index < 0 ? visible : [...visible.slice(index + 1), ...visible.slice(0, index + 1)]
    const target = ordered.find((item) => !removeCurrent || item.id !== card.id)
    if (view === 'saved' && notifyWhenAlone && (!target || target.id === card.id)) {
      setNoOtherSavedWord(true)
      return
    }
    if (target) {
      setHistory(visitLearnWord(currentHistory, target.id))
      setSelectedId(target.id)
    } else {
      setHistory({ ...currentHistory, index: currentHistory.ids.length })
      setSelectedId(null)
    }
    resetActivity()
  }

  const selectWord = (id: string) => {
    setHistory(visitLearnWord(currentHistory, id))
    setSelectedId(id)
    resetActivity()
  }

  const toggleQuiz = () => {
    setShowQuiz(!showQuiz)
    setChoice(null)
  }

  return (
    <section className="learn-mode" aria-label="Learn new words">
      {settingsOpen && (
        <aside ref={settingsRef} className="learn-settings" role="dialog" aria-labelledby="learn-settings-title">
          <div className="learn-settings-heading">
            <h2 id="learn-settings-title" className="menu-panel-title">Learn settings</h2>
            <button type="button" className="quiet-button" onClick={() => onCloseSettings(true)}>Done</button>
          </div>
          <div className="learn-tabs" role="group" aria-label="Learning view">
          {([['guided', 'Guided'], ['browse', 'Browse'], ['saved', 'Continue learning']] as const).map(([id, label]) => (
            <button type="button" key={id} aria-pressed={view === id} onClick={() => changeView(id)}>{label}</button>
          ))}
          </div>
          <div className="learn-filters">
            <div className="learn-filter">
              <span>Topic</span>
              <MenuSelect ariaLabel="Topic" value={topic}
                options={[{ value: '', label: 'All topics' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
                onChange={(value) => { setTopic(value); resetNavigation() }} />
            </div>
            <div className="learn-filter">
              <span>Level</span>
              <MenuSelect ariaLabel="Level" value={level}
                options={[{ value: '', label: 'All levels' }, { value: 'A1', label: 'A1' }, { value: 'A2', label: 'A2' }]}
                onChange={(value) => { setLevel(value); resetNavigation() }} />
            </div>
          </div>
          {view === 'browse' && (
          <label className="learn-search">Find a word
            <input value={query} onChange={(event) => { setQuery(event.target.value); resetNavigation() }} placeholder="German or meaning" />
          </label>
          )}
          {view !== 'guided' && visible.length > 0 && (
            <div className="learn-search">
              <span>Select a word</span>
              <MenuSelect ariaLabel="Select a word" value={card?.id ?? ''}
                options={visible.map((item) => ({ value: item.id, label: `${item.prompt} — ${item.meaning}` }))}
                onChange={selectWord} />
            </div>
          )}
        </aside>
      )}
      {!canSave && <p className="learn-note" role="alert">Your saved deck could not be read, so learning progress cannot be saved on this device.</p>}
      {savingError && <p className="learn-note" role="alert">{savingError}</p>}
      {(topic || level || view !== 'guided' || query.trim()) && (
        <p className="learn-scope">{[view === 'saved' ? 'Continue learning' : view === 'browse' ? 'Browse' : '', topic, level, query.trim() ? 'Search active' : ''].filter(Boolean).join(' · ')}</p>
      )}
      {card ? (
        <>
          <div className="deck-shell">
            <div className="card card-back card-back-3" aria-hidden="true" />
            <div className="card card-back card-back-2" aria-hidden="true" />
            <article key={card.id} className="flashcard learn-card">
              <div className="card-header"><span className="tag">{card.category}</span><span className="progress">{visible.length} available</span></div>
              <div className="learn-card-content">
                {showQuiz && !readOnly ? (
                  <div className="learn-quiz">
                    <p>Which German word means <strong>{card.meaning}</strong>?</p>
                    {choices?.options.length === 4 ? (
                      <div className="learn-choices" role="group" aria-label="Practice choices">
                        {choices.options.map((option) => (
                          <button key={option.cardId} type="button" disabled={choice !== null} onClick={() => setChoice(option.cardId)} lang="de">{option.prompt}</button>
                        ))}
                      </div>
                    ) : <p className="learn-note">Not enough distinct choices yet. You can continue without a check.</p>}
                    {choice && <p role="status" className="learn-note">{choice === card.id ? 'That’s right.' : `Not quite—${card.prompt} means ${card.meaning}.`} This check doesn’t affect your score or schedule.</p>}
                  </div>
                ) : (
                  <>
                    <div className="learn-word">
                      <div><p className="prompt-label">German</p><CopyText as="h2" text={card.prompt} label="Copy German word or phrase" onCopy={onCopy} /></div>
                    </div>
                    <WordAudio key={`${card.id}-${audioVersion}`} card={card} />
                    <div className="learn-meaning"><span>Meaning</span><strong>{card.meaning}</strong></div>
                    {(card.article || card.plural) && <div className="learn-facts">
                      {card.article && <span>Article: <strong>{card.article}</strong></span>}
                      {card.plural && <span>Plural: <strong lang="de">{card.plural}</strong></span>}
                    </div>}
                    <InteractiveExample key={card.id} example={card.example} translation={card.translation ?? ''} onCopy={onCopy} />
                  </>
                )}
              </div>
            </article>
          </div>
          {readOnly ? (
            <p className="learn-revisit-status">{card.lastReviewedAt ? 'Already reviewed' : 'Scheduled for review'} · viewing only</p>
          ) : showReview ? (
            <div className="learn-review">
              <strong>Your daily new-word target is complete.</strong>
              <p>Adding this word continues beyond today’s target.</p>
              <button type="button" className="rating" disabled={!canSave} onClick={() => {
                if (onSchedule(card.id, true)) next(true)
              }}>Add anyway</button>
              <button type="button" className="quiet-button" onClick={() => setShowReview(false)}>Not yet</button>
            </div>
          ) : (
            <>
              <div className="learn-actions" aria-label="Learning actions">
                <button type="button" className="rating" onClick={toggleQuiz}>{showQuiz ? 'Back to word' : 'Gentle check'}</button>
                <button type="button" className="rating" disabled={!canSave || (card.learning?.saved && !savingError)} onClick={() => onSave(card.id)}>{card.learning?.saved && !savingError ? 'Saved' : 'Save'}</button>
                <button type="button" className="rating learn-ready" disabled={!canSave} onClick={() => {
                  if (dailyLimitReached) setShowReview(true)
                  else if (onSchedule(card.id, false)) next(true)
                }}>Add to reviews</button>
              </div>
            </>
          )}
          {(!showReview || readOnly) && <div className="learn-navigation">
            <button type="button" className="quiet-button" disabled={!previousHistory} onClick={previous}><ArrowLeft size={16} aria-hidden="true" /> Previous</button>
            {!readOnly && <button type="button" className="quiet-button" onClick={() => {
              setSkipped((current) => current.includes(card.id) ? current : [...current, card.id])
              next(view === 'guided')
            }}>Skip for now</button>}
            <button type="button" className="quiet-button" onClick={() => next(false, true)}>Next word <ArrowRight size={16} aria-hidden="true" /></button>
          </div>}
        </>
      ) : <>
        <p className="learn-empty" role="status">{view === 'saved' ? 'No saved words in these filters yet.' : 'No new words match these filters in this session.'} Open Learn settings in the ··· menu to change your selection.</p>
        {previousHistory && <div className="learn-navigation"><button type="button" className="quiet-button" onClick={previous}><ArrowLeft size={16} aria-hidden="true" /> Previous</button></div>}
      </>}
      {view === 'saved' && (showNoOtherSavedWord || !card) && (
        <div className="learn-end">
          {showNoOtherSavedWord && <p role="status">There are no other saved words in these filters.</p>}
          <div className="learn-end-actions" role="group" aria-label="Switch learning view">
            <button type="button" className="quiet-button" onClick={() => changeView('guided')}>Go to Guided</button>
            <button type="button" className="quiet-button" onClick={() => changeView('browse')}>Go to Browse</button>
          </div>
        </div>
      )}
      <p className="learn-footer">Words added to reviews are due in 10 minutes. Source examples and levels may contain errors.</p>
    </section>
  )
}
