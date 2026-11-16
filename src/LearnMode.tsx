import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines } from 'lucide-react'
import type { Card } from './deckImport'
import { getStudySetChoiceOptions } from './choiceQuiz'
import { getStudySetTags } from './studySets'
import type { ReviewMode } from './scheduler'
import { getRecording } from './pronunciation'
import { MenuSelect } from './MenuSelect'
import { containsFloatingTarget } from './floatingTarget'
import { CopyText } from './CopyText'
import { InteractiveExample } from './InteractiveExample'
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
  onReview: (id: string, mode: ReviewMode, beyondLimit: boolean) => void
  onCopy: (text: string) => void
}

export default function LearnMode({ cards, initialTag, dailyLimitReached, canSave, savingError, settingsOpen, onCloseSettings, onSave, onReview, onCopy }: Props) {
  const [topic, setTopic] = useState(initialTag === 'A1' || initialTag === 'A2' ? '' : initialTag)
  const [level, setLevel] = useState(initialTag === 'A1' || initialTag === 'A2' ? initialTag : '')
  const [view, setView] = useState<'guided' | 'browse' | 'saved'>('guided')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<string[]>([])
  const [choice, setChoice] = useState<string | null>(null)
  const [showQuiz, setShowQuiz] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [audioMessage, setAudioMessage] = useState<string | null>(null)
  const recordingRef = useRef<HTMLAudioElement | null>(null)
  const settingsRef = useRef<HTMLElement>(null)
  const tags = useMemo(() => getStudySetTags(cards), [cards])
  const scoped = useMemo(() => cards.filter((card) =>
    card.status === 'active' && card.lastReviewedAt === null &&
    (!topic || card.tags.includes(topic)) && (!level || card.tags.includes(level)),
  ), [cards, topic, level])
  const visible = useMemo(() => scoped.filter((card) => {
    if (view === 'saved' && !card.learning?.saved) return false
    if (view === 'guided' && skipped.includes(card.id)) return false
    const text = query.trim().toLocaleLowerCase()
    return !text || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(text)
  }), [scoped, view, skipped, query])
  const card = visible.find((item) => item.id === selectedId) ?? visible[0]
  const recording = card ? getRecording(card) : undefined
  const choices = card ? getStudySetChoiceOptions(card, scoped, cards, 0) : null

  useEffect(() => () => {
    recordingRef.current?.pause()
    recordingRef.current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

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

  const speak = (fallback = false) => {
    if (!card) return
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setAudioMessage(fallback ? 'The recording could not play and device speech is unavailable.' : 'Pronunciation is unavailable on this device.')
      return
    }
    const voice = window.speechSynthesis.getVoices().find((item) => /^de(?:-|$)/i.test(item.lang))
    if (!voice) {
      setAudioMessage(fallback ? 'The recording could not play and no German device voice is available.' : 'No German device voice is available. Check your device language and speech settings.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(card.prompt)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.onerror = (event) => {
      if (event.error !== 'interrupted' && event.error !== 'canceled') setAudioMessage('The device could not play pronunciation.')
    }
    setAudioMessage(fallback ? 'The recording could not play; using your device’s German voice.' : 'Using your device’s German voice.')
    window.speechSynthesis.speak(utterance)
  }

  const playPronunciation = () => {
    if (!recording) {
      speak()
      return
    }
    recordingRef.current?.pause()
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    const audio = new Audio(recording.url)
    audio.preload = 'none'
    recordingRef.current = audio
    setAudioMessage('Playing the word-only recording from Wikimedia Commons.')
    let failed = false
    const fallback = () => {
      if (recordingRef.current !== audio || failed) return
      failed = true
      speak(true)
    }
    audio.onerror = fallback
    audio.play().catch(fallback)
  }

  const next = () => {
    if (!card) return
    const index = visible.findIndex((item) => item.id === card.id)
    setSelectedId(visible[(index + 1) % visible.length]?.id ?? null)
    resetActivity()
  }

  const resetActivity = () => {
    setChoice(null)
    setShowQuiz(false)
    setShowReview(false)
    setAudioMessage(null)
    recordingRef.current?.pause()
    recordingRef.current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  const toggleQuiz = () => {
    setShowQuiz(!showQuiz)
    setChoice(null)
    setAudioMessage(null)
    recordingRef.current?.pause()
    recordingRef.current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  return (
    <section className="learn-mode" aria-label="Learn new words">
      {settingsOpen && (
        <aside ref={settingsRef} className="learn-settings" role="dialog" aria-labelledby="learn-settings-title">
          <div className="learn-settings-heading">
            <h2 id="learn-settings-title">Learn settings</h2>
            <button type="button" className="quiet-button" onClick={() => onCloseSettings(true)}>Done</button>
          </div>
          <div className="learn-tabs" role="group" aria-label="Learning view">
          {([['guided', 'Guided'], ['browse', 'Browse'], ['saved', 'Continue learning']] as const).map(([id, label]) => (
            <button type="button" key={id} aria-pressed={view === id} onClick={() => { setView(id); setSelectedId(null); setQuery(''); resetActivity() }}>{label}</button>
          ))}
          </div>
          <div className="learn-filters">
            <div className="learn-filter">
              <span>Topic</span>
              <MenuSelect ariaLabel="Topic" value={topic}
                options={[{ value: '', label: 'All topics' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
                onChange={(value) => { setTopic(value); setSelectedId(null); resetActivity() }} />
            </div>
            <div className="learn-filter">
              <span>Level</span>
              <MenuSelect ariaLabel="Level" value={level}
                options={[{ value: '', label: 'All levels' }, { value: 'A1', label: 'A1' }, { value: 'A2', label: 'A2' }]}
                onChange={(value) => { setLevel(value); setSelectedId(null); resetActivity() }} />
            </div>
          </div>
          {view === 'browse' && (
          <label className="learn-search">Find a word
            <input value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(null); resetActivity() }} placeholder="German or meaning" />
          </label>
          )}
          {view !== 'guided' && visible.length > 0 && (
            <div className="learn-search">
              <span>Select a word</span>
              <MenuSelect ariaLabel="Select a word" value={card?.id ?? ''}
                options={visible.map((item) => ({ value: item.id, label: `${item.prompt} — ${item.meaning}` }))}
                onChange={(value) => { setSelectedId(value); resetActivity() }} />
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
                {showQuiz ? (
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
                      <button type="button" className="quiet-button learn-audio" onClick={playPronunciation} aria-label={`Hear ${card.prompt}`}><AudioLines size={16} aria-hidden="true" /> Listen</button>
                    </div>
                    {recording && <p className="learn-credit">External word-only audio: <a href={recording.source} target="_blank" rel="noreferrer">{recording.author} / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a> · unchanged</p>}
                    {audioMessage && <p className="learn-note" role="status">{audioMessage}</p>}
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
          {showReview ? (
            <div className="learn-review">
              <strong>Choose your first review</strong>
              {dailyLimitReached && <p>Your daily new-word target is complete. Starting this review continues beyond today’s target.</p>}
              <div className="learn-review-modes">
                {([['recall', 'Recall'], ['choice', 'Choose'], ['production', 'Produce']] as const).map(([mode, label]) => (
                  <button type="button" key={mode} disabled={mode === 'choice' && choices?.options.length !== 4}
                    onClick={() => onReview(card.id, mode, dailyLimitReached)}>{label}</button>
                ))}
              </div>
              {choices?.options.length !== 4 && <p className="learn-note">Choose needs four distinct words; Recall and Produce are available.</p>}
              <button type="button" className="quiet-button" onClick={() => setShowReview(false)}>Not yet</button>
            </div>
          ) : (
            <>
              <div className="learn-actions" aria-label="Learning actions">
                <button type="button" className="rating" onClick={toggleQuiz}>{showQuiz ? 'Back to word' : 'Gentle check'}</button>
                <button type="button" className="rating" disabled={!canSave || (card.learning?.saved && !savingError)} onClick={() => onSave(card.id)}>{card.learning?.saved && !savingError ? 'Saved' : 'Save'}</button>
                <button type="button" className="rating learn-ready" onClick={() => setShowReview(true)}>Ready to review</button>
              </div>
              <div className="learn-navigation">
                <button type="button" className="quiet-button" onClick={() => { setSkipped((current) => [...current, card.id]); next() }}>Skip for now</button>
                <button type="button" className="quiet-button" onClick={next}>Next word →</button>
              </div>
            </>
          )}
        </>
      ) : <p className="learn-empty">{view === 'saved' ? 'No saved words in these filters yet.' : 'No new words match these filters in this session.'} Open Learn settings in the ··· menu to change your selection.</p>}
      <p className="learn-footer">Learning here doesn’t change your review schedule. Source examples and levels may contain errors.</p>
    </section>
  )
}
