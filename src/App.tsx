import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  detectWeakPattern,
  getCardsIntroducedToday,
  getLocalDayKey,
  getNewCardQuotaRemaining,
  getSessionCardIds,
  scheduleReview,
  type RecallField,
  type Rating,
  type ReviewMode,
} from './scheduler'
import {
  cardContentKey,
  isDeckCard,
  normalizeDeckCard,
  parseDeckFile,
  type Card,
} from './deckImport'
import { getStudySetChoiceOptions } from './choiceQuiz'
import {
  createDefaultStudyPlan,
  estimateGoalPace,
  INTENSITY_SETTINGS,
  isStudyPlan,
  type StudyIntensity,
  type StudyPlan,
} from './studyPlan'
import { isProductionAnswerCorrect } from './productionQuiz'
import { AccountMenu, type AccountUser } from './AccountMenu'
import { mergeAccountProgress, type AccountProgress } from './accountSync'
import LearnMode from './LearnMode'
import { reviewLearningCard, saveForLearning } from './learning'
import starterPack from './data/german-starter-pack.json'
import {
  getCardsForStudySet,
  getStudySetNewCardLimit,
  getStudySetProgress,
  getStudySetTags,
} from './studySets'
import './App.css'

type LoadedDeck = {
  cards: Card[]
  warning: string | null
  canSave: boolean
}

type NewCardInput = {
  word: string
  category: string
  article: string
  meaning: string
  plural: string
  example: string
  translation: string
  level: string
  tags: string
}

type ChoiceFeedback = {
  cardId: string
  selectedId: string
  correct: boolean
}

type ProductionFeedback = {
  cardId: string
  answer: string
  correct: boolean
}

const STORAGE_KEY = 'deutsch-deck-v1'
const STUDY_PLAN_STORAGE_KEY = 'deutsch-study-plan-v1'
const LOCAL_PROGRESS_UPDATED_AT_KEY = 'deutsch-progress-updated-at-v1'
const LOCAL_STUDY_PLAN_UPDATED_AT_KEY = 'deutsch-study-plan-updated-at-v1'
const INITIAL_NOW = Date.now()
const DECK_FILE_VERSION = 1

const nowIso = () => new Date().toISOString()

const makeCard = (
  id: string,
  prompt: string,
  meaning: string,
  example: string,
  translation: string,
  category: string,
  tags: string[],
  forms: { article?: string; plural?: string } = {},
): Card => ({
  id,
  prompt,
  ...forms,
  meaning,
  example,
  translation,
  category,
  tags,
  status: 'active',
  dueAt: nowIso(),
  intervalDays: 0,
  repetitions: 0,
  easeFactor: 2.5,
  lapses: 0,
  lastReviewedAt: null,
  lastRating: null,
  correctCount: 0,
  incorrectCount: 0,
  reviewHistory: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
})

const createSeedDeck = (): Card[] =>
  starterPack.cards.map((entry) =>
    makeCard(
      entry.id,
      entry.article ? `${entry.article} ${entry.word}` : entry.word,
      entry.meaning,
      entry.example,
      entry.translation,
      entry.category,
      [...new Set([...entry.tags, entry.level])],
      entry.article
        ? { article: entry.article, ...(entry.plural ? { plural: entry.plural } : {}) }
        : {},
    ),
  )

const loadDeck = (): LoadedDeck => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { cards: createSeedDeck(), warning: null, canSave: true }

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isDeckCard)) {
      return {
        cards: createSeedDeck(),
        warning: 'The saved deck is invalid. Your saved data has not been overwritten.',
        canSave: false,
      }
    }

    return {
      cards: parsed.length > 0 ? parsed.map(normalizeDeckCard) : createSeedDeck(),
      warning: null,
      canSave: true,
    }
  } catch {
    return {
      cards: createSeedDeck(),
      warning: 'The saved deck could not be read. Your saved data has not been overwritten.',
      canSave: false,
    }
  }
}

type LoadedStudyPlan = {
  plan: StudyPlan
  warning: string | null
}

const loadStudyPlan = (): LoadedStudyPlan => {
  try {
    const raw = localStorage.getItem(STUDY_PLAN_STORAGE_KEY)
    if (!raw) return { plan: createDefaultStudyPlan(), warning: null }
    const parsed: unknown = JSON.parse(raw)
    if (!isStudyPlan(parsed)) {
      return {
        plan: createDefaultStudyPlan(),
        warning: 'Saved goal settings are invalid. Your saved settings have not been overwritten.',
      }
    }
    return { plan: parsed, warning: null }
  } catch {
    return {
      plan: createDefaultStudyPlan(),
      warning: 'Goal settings could not be read. Your saved settings have not been overwritten.',
    }
  }
}

const localDateString = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const formatHours = (hours: number) => {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  return `${hours.toFixed(1)} hr`
}

const relativeReviewTime = (dueAt: string, now: number) => {
  const minutes = Math.max(1, Math.ceil((new Date(dueAt).getTime() - now) / 60_000))
  if (minutes < 60) return `A card will be ready again in ${minutes} min.`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `Your next review is in about ${hours} hr.`
  const days = Math.ceil(hours / 24)
  return `Your next review is in ${days} day${days === 1 ? '' : 's'}.`
}

const intervalLabel = (card: Card, rating: Rating, now: Date) => {
  const preview = scheduleReview(card, rating, now)
  if (rating === 'again') return '10 min'
  return `${preview.intervalDays} ${preview.intervalDays === 1 ? 'day' : 'days'}`
}

const readApiResponse = async (response: Response): Promise<unknown> => {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.status >= 500) {
      throw new Error('Could not reach the account service. Restart the app with npm run dev and configure the MongoDB settings in .env.')
    }
    throw new Error('The account server returned an invalid response.')
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body &&
      typeof body.error === 'string'
      ? body.error
      : 'The account request could not be completed.'
    throw new Error(message)
  }
  return body
}

const isAccountProgress = (value: unknown): value is AccountProgress =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'cards' in value &&
      Array.isArray(value.cards) &&
      value.cards.every(isDeckCard) &&
      'studyPlan' in value &&
      isStudyPlan(value.studyPlan),
  )

type CloudProgress = AccountProgress & {
  updatedAt: string
  studyPlanUpdatedAt?: string
}

const isCloudProgress = (value: unknown): value is CloudProgress =>
  Boolean(
    isAccountProgress(value) &&
      'updatedAt' in value &&
      typeof value.updatedAt === 'string' &&
      (!('studyPlanUpdatedAt' in value) || typeof value.studyPlanUpdatedAt === 'string'),
  )

type MenuSelectOption<T extends string> = {
  value: T
  label: string
  group?: string
}

function MenuSelect<T extends string>({
  ariaLabel,
  invalid = false,
  describedBy,
  options,
  value,
  onChange,
}: {
  ariaLabel: string
  invalid?: boolean
  describedBy?: string
  options: MenuSelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selectId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedLabel = options[selectedIndex]?.label ?? 'Choose an option'

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const focusOption = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, options.length - 1))
    window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus())
  }

  const openFromKeyboard = (index: number) => {
    if (options.length === 0) return
    setOpen(true)
    focusOption(index)
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openFromKeyboard(selectedIndex < 0 ? 0 : selectedIndex)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      focusOption(nextIndex)
    }
  }

  const chooseOption = (option: MenuSelectOption<T>) => {
    onChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      className="menu-select"
      ref={rootRef}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="menu-select-trigger"
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={selectId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selectedLabel}</span>
        <span className="menu-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-select-popover" id={selectId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.group && options[index - 1]?.group !== option.group && (
                <p className="menu-select-group" aria-hidden="true">{option.group}</p>
              )}
              <button
                ref={(element) => { optionRefs.current[index] = element }}
                type="button"
                role="option"
                aria-label={option.group ? `${option.group}: ${option.label}` : option.label}
                aria-selected={option.value === value}
                className={option.value === value ? 'menu-select-option selected' : 'menu-select-option'}
                onClick={() => chooseOption(option)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span>{option.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function AddCardDialog({
  defaultTag,
  onClose,
  onSave,
}: {
  defaultTag: string
  onClose: () => void
  onSave: (input: NewCardInput) => void
}) {
  const [category, setCategory] = useState('noun')
  const [article, setArticle] = useState('')
  const [articleError, setArticleError] = useState(false)
  const [level, setLevel] = useState('A1')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (category === 'noun' && !article) {
      setArticleError(true)
      return
    }
    const formData = new FormData(event.currentTarget)
    onSave({
      word: String(formData.get('word') ?? '').trim(),
      category,
      article,
      meaning: String(formData.get('meaning') ?? '').trim(),
      plural: String(formData.get('plural') ?? '').trim(),
      example: String(formData.get('example') ?? '').trim(),
      translation: String(formData.get('translation') ?? '').trim(),
      level,
      tags: String(formData.get('tags') ?? '').trim(),
    })
  }

  return (
    <div
      className="modal-scrim add-modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="add-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-card-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="add-card-title">Add a word</h2>
          </div>
          <button type="button" className="close-dialog" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              {category === 'noun' ? 'Noun without article' : 'German word or phrase'}
              <input
                name="word"
                autoFocus
                required
                maxLength={100}
                placeholder={category === 'noun' ? 'Wohnung' : 'gehen'}
              />
            </label>
            <div className="custom-select-field">
              <span>Type</span>
              <MenuSelect
                ariaLabel="Type"
                value={category}
                onChange={(value) => {
                  setCategory(value)
                  setArticleError(false)
                }}
                options={[
                  { value: 'noun', label: 'Noun' },
                  { value: 'verb', label: 'Verb' },
                  { value: 'adjective', label: 'Adjective' },
                  { value: 'adverb', label: 'Adverb' },
                  { value: 'numeral', label: 'Number' },
                  { value: 'phrase', label: 'Phrase' },
                ]}
              />
            </div>
          </div>

          {category === 'noun' && (
            <div className="form-row">
              <div className="custom-select-field">
                <span>Article</span>
                <MenuSelect
                  ariaLabel="Article"
                  value={article}
                  invalid={articleError}
                  describedBy={articleError ? 'article-error' : undefined}
                  onChange={(value) => {
                    setArticle(value)
                    if (value) setArticleError(false)
                  }}
                  options={[
                    { value: '', label: 'Choose article' },
                    { value: 'der', label: 'der' },
                    { value: 'die', label: 'die' },
                    { value: 'das', label: 'das' },
                  ]}
                />
                {articleError && (
                  <span className="custom-select-error" id="article-error" role="alert">
                    Choose an article for this noun.
                  </span>
                )}
              </div>
              <label>
                Plural
                <input name="plural" maxLength={100} placeholder="die Wohnungen" />
              </label>
            </div>
          )}

          <div className="form-row">
            <label>
              Meaning
              <input name="meaning" required maxLength={160} placeholder="apartment" />
            </label>
            <div className="custom-select-field">
              <span>Level</span>
              <MenuSelect
                ariaLabel="Level"
                value={level}
                onChange={setLevel}
                options={[
                  { value: 'A1', label: 'A1' },
                  { value: 'A2', label: 'A2' },
                ]}
              />
            </div>
          </div>

          <label>
            Example in German
            <input name="example" required maxLength={240} placeholder="Die Wohnung ist sehr schön." />
          </label>
          <label>
            Example translation
            <input name="translation" required maxLength={240} placeholder="The apartment is very beautiful." />
          </label>
          <label>
            Course or unit tags <small>Separate tags with |</small>
            <input
              name="tags"
              maxLength={120}
              defaultValue={defaultTag}
              placeholder="VHL Lernportal|Lektion 1"
            />
          </label>

          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Add to deck</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function DatePicker({
  value,
  min,
  onChange,
}: {
  value: string
  min: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [displayMonth, setDisplayMonth] = useState(() => {
    const date = parseLocalDate(value)
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedDate = parseLocalDate(value)
  const minimumDate = parseLocalDate(min)
  const minimumMonth = new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1)
  const monthLabel = displayMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
  const formattedDate = selectedDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const firstWeekday = (new Date(
    displayMonth.getFullYear(),
    displayMonth.getMonth(),
    1,
  ).getDay() + 6) % 7
  const daysInMonth = new Date(
    displayMonth.getFullYear(),
    displayMonth.getMonth() + 1,
    0,
  ).getDate()
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7
  const weeks = Array.from({ length: cellCount / 7 }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, weekdayIndex) => {
      const day = weekIndex * 7 + weekdayIndex - firstWeekday + 1
      return day > 0 && day <= daysInMonth
        ? new Date(displayMonth.getFullYear(), displayMonth.getMonth(), day)
        : null
    }),
  )

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const changeMonth = (amount: number) => {
    setDisplayMonth((current) =>
      new Date(current.getFullYear(), current.getMonth() + amount, 1),
    )
  }

  const chooseDate = (date: Date) => {
    const dateValue = localDateString(date)
    if (dateValue < min) return
    onChange(dateValue)
    setDisplayMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div
      className="date-picker"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="date-picker-trigger"
        aria-label={`Target date: ${formattedDate}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setDisplayMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1))
          setOpen((current) => !current)
        }}
      >
        <span>{formattedDate}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="3.25" y="4.75" width="13.5" height="12" rx="2" />
          <path d="M6.5 3.25v3M13.5 3.25v3M3.5 8.25h13" />
        </svg>
      </button>
      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Choose target date">
          <div className="date-picker-heading">
            <button
              type="button"
              aria-label="Previous month"
              disabled={displayMonth <= minimumMonth}
              onClick={() => changeMonth(-1)}
            >
              ‹
            </button>
            <strong>{monthLabel}</strong>
            <button type="button" aria-label="Next month" onClick={() => changeMonth(1)}>
              ›
            </button>
          </div>
          <div className="date-picker-grid" role="grid" aria-label={monthLabel}>
            <div className="date-picker-week" role="row">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <span key={day} role="columnheader">{day}</span>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div className="date-picker-week" role="row" key={weekIndex}>
                {week.map((date, weekdayIndex) => {
                  if (!date) {
                    return <span className="date-picker-empty" role="gridcell" key={weekdayIndex} />
                  }
                  const dateValue = localDateString(date)
                  const isSelected = dateValue === value
                  const isToday = dateValue === min
                  return (
                    <span role="gridcell" key={weekdayIndex}>
                      <button
                        type="button"
                        className={[
                          'date-picker-day',
                          isSelected ? 'selected' : '',
                          isToday ? 'today' : '',
                        ].filter(Boolean).join(' ')}
                        aria-label={date.toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        aria-pressed={isSelected}
                        disabled={dateValue < min}
                        onClick={() => chooseDate(date)}
                      >
                        {date.getDate()}
                      </button>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StudyPlanDialog({
  initialPlan,
  now,
  onClose,
  onSave,
}: {
  initialPlan: StudyPlan
  now: Date
  onClose: () => void
  onSave: (plan: StudyPlan) => void
}) {
  const [draft, setDraft] = useState(initialPlan)
  const today = localDateString(now)
  const estimate = estimateGoalPace(draft, now)
  const intensity = INTENSITY_SETTINGS[draft.intensity]
  const update = <K extends keyof StudyPlan,>(key: K, value: StudyPlan[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isStudyPlan(draft)) onSave(draft)
  }

  const dailyEstimate = estimate.guidedHoursPerDay
  const practiceNote = dailyEstimate && dailyEstimate.min * 60 > intensity.minutesPerDay
    ? `About ${intensity.minutesPerDay} minutes are set aside for vocabulary cards each day. Plan extra time for your course and the other language skills.`
    : null
  const estimateMessage = dailyEstimate
    ? dailyEstimate.max === 0
      ? 'Your current level meets or exceeds this goal.'
      : `Plan for about ${formatHours(dailyEstimate.min)}–${formatHours(dailyEstimate.max)} of guided study each day.`
    : estimate.daysRemaining === 0
      ? 'Choose a future target date to see an estimate.'
      : draft.currentLevel === 'unknown'
        ? 'Choose your starting level to see an estimate.'
        : 'An estimate is not available for this goal yet.'

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="add-dialog study-plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-plan-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="study-plan-title">Goal &amp; study pace</h2>
          </div>
          <button type="button" className="close-dialog" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="custom-select-field">
              <span>Starting level</span>
              <MenuSelect
                ariaLabel="Starting level"
                value={draft.currentLevel}
                onChange={(value) => update('currentLevel', value)}
                options={[
                  { value: 'unknown', label: 'Not sure yet' },
                  { value: 'A0', label: 'New to German' },
                  { value: 'A1', label: 'A1' },
                  { value: 'A2', label: 'A2' },
                  { value: 'B1', label: 'B1' },
                ]}
              />
            </div>
            <div className="custom-select-field">
              <span>Goal level</span>
              <MenuSelect
                ariaLabel="Goal level"
                value={draft.targetLevel}
                onChange={(value) => update('targetLevel', value)}
                options={[
                  { value: 'A1', label: 'A1' },
                  { value: 'A2', label: 'A2' },
                  { value: 'B1', label: 'B1' },
                  { value: 'B2', label: 'B2' },
                ]}
              />
            </div>
          </div>
          <div className="custom-select-field">
            <span>Target date</span>
            <DatePicker
              value={draft.targetDate}
              min={today}
              onChange={(value) => update('targetDate', value)}
            />
          </div>
          <fieldset className="intensity-options">
            <legend>Your daily card pace</legend>
            {(Object.keys(INTENSITY_SETTINGS) as StudyIntensity[]).map((level) => {
              const settings = INTENSITY_SETTINGS[level]
              return (
                <label key={level} className={draft.intensity === level ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="intensity"
                    value={level}
                    checked={draft.intensity === level}
                    onChange={() => update('intensity', level)}
                  />
                  <span className="intensity-copy">
                    <strong className="intensity-name">{settings.label}</strong>
                    <span className="intensity-summary">
                      Up to {settings.newCardsPerDay} new cards/day · max {settings.reviewLimit}
                      {' '}due reviews/set · ~{settings.minutesPerDay} min/day
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div className="goal-estimate" role="status">
            <div className="goal-estimate-heading">
              <span>Time to target</span>
              <strong>{estimate.daysRemaining} days</strong>
            </div>
            <p className="goal-estimate-summary">{estimateMessage}</p>
            {practiceNote && <p className="goal-practice-note">{practiceNote}</p>}
            <details className="goal-estimate-details">
              <summary>About this estimate</summary>
              <p>
                This is a broad planning estimate based on Goethe-Institut guided-course hour
                ranges, not a promise. Reaching a CEFR level also takes practice in listening,
                reading, speaking, and writing; vocabulary cards support that work but cannot
                replace it.
              </p>
              <a href="https://www.goethe.de/ins/gb/en/sta/lon/kur/faq.html" target="_blank" rel="noreferrer">
                Goethe-Institut source
              </a>
            </details>
          </div>
          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button">Save goal</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function StudySetSelect({
  cards,
  value,
  onChange,
}: {
  cards: Card[]
  value: string
  onChange: (tag: string) => void
}) {
  const tags = getStudySetTags(cards)
  const levels = (['A1', 'A2'] as const).filter((level) =>
    cards.some((card) => card.status === 'active' && card.tags.includes(level)),
  )
  const options: MenuSelectOption<string>[] = [
    { value: '', label: 'All words' },
    ...levels.map((level) => ({ value: level, label: level, group: 'CEFR level' })),
    ...tags.map((tag) => ({ value: tag, label: tag, group: 'Lessons and topics' })),
  ]

  return (
    <div className="study-set-filter">
      <span>Study set</span>
      <MenuSelect ariaLabel="Study set" options={options} value={value} onChange={onChange} />
    </div>
  )
}

function StudySetProgressSummary({
  cards,
  tag,
  compact = false,
}: {
  cards: Card[]
  tag: string
  compact?: boolean
}) {
  const progress = getStudySetProgress(cards)
  const hasReviews =
    progress.recall.total + progress.choice.answered + progress.production.answered > 0

  if (compact && !hasReviews) return null

  return (
    <section
      className={`study-set-progress${compact ? ' compact' : ''}`}
      aria-label={`Progress for ${tag || 'all words'}`}
    >
      <strong>{compact ? 'Progress' : tag ? `${tag} progress` : 'Overall progress'}</strong>
      {hasReviews ? (
        <ul>
          {progress.recall.total > 0 && (
            <li>
              <strong className="progress-mode">Recall</strong>
              <span>{progress.recall.remembered} remembered · {progress.recall.again} to revisit</span>
            </li>
          )}
          {progress.choice.answered > 0 && (
            <li>
              <strong className="progress-mode">Choose</strong>
              <span>{progress.choice.correct} of {progress.choice.answered} correct</span>
            </li>
          )}
          {progress.production.answered > 0 && (
            <li>
              <strong className="progress-mode">Produce</strong>
              <span>{progress.production.correct} of {progress.production.answered} correct</span>
            </li>
          )}
        </ul>
      ) : <span>No review history in this set yet.</span>}
    </section>
  )
}

function SessionSettingsDialog({
  cards,
  tag,
  goalSummary,
  onChange,
  onAdjustGoal,
  onClose,
}: {
  cards: Card[]
  tag: string
  goalSummary: string
  onChange: (tag: string) => void
  onAdjustGoal: () => void
  onClose: () => void
}) {
  const scopedCards = getCardsForStudySet(cards, tag)
  const reviewedCount = scopedCards.filter((card) => card.lastReviewedAt !== null).length

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="add-dialog session-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-settings-title"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="session-settings-title">Tune your session</h2>
          </div>
          <button type="button" className="close-dialog" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="session-setting-block">
          <StudySetSelect cards={cards} value={tag} onChange={onChange} />
          <p className="session-reviewed-count">
            <strong>{reviewedCount.toLocaleString()}</strong> of {scopedCards.length.toLocaleString()}{' '}
            {scopedCards.length === 1 ? 'word' : 'words'} reviewed
          </p>
        </div>
        <StudySetProgressSummary cards={scopedCards} tag={tag} compact />
        <div className="session-goal">
          <div className="session-goal-details">
            <span>Daily goal &amp; pace</span>
            <p className="goal-summary">{goalSummary.replace(/^Goal:\s*/, '')}</p>
          </div>
          <button type="button" className="quiet-button goal-edit-button" onClick={onAdjustGoal}>
            Adjust goal
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary-button" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [loaded] = useState(loadDeck)
  const [loadedStudyPlan] = useState(loadStudyPlan)
  const [cards, setCards] = useState<Card[]>(loaded.cards)
  const [studyPlan, setStudyPlan] = useState(loadedStudyPlan.plan)
  const [canSave, setCanSave] = useState(loaded.canSave)
  const [storageWarning, setStorageWarning] = useState(loaded.warning)
  const [studyPlanWarning, setStudyPlanWarning] = useState(loadedStudyPlan.warning)
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountEmail = accountUser?.email
  const [accountSyncReady, setAccountSyncReady] = useState(false)
  const [accountSyncStatus, setAccountSyncStatus] = useState<string | null>(null)
  const [accountSyncError, setAccountSyncError] = useState<string | null>(null)
  const accountRevision = useRef(0)
  const accountIdentity = useRef<string | null>(null)
  const localProgressRef = useRef({ cards, studyPlan, canSave, studyPlanWarning })
  const [revealed, setRevealed] = useState(false)
  const [now, setNow] = useState(INITIAL_NOW)
  const [sessionIds, setSessionIds] = useState(() =>
    getSessionCardIds(
      loaded.cards,
      new Date(INITIAL_NOW),
      getNewCardQuotaRemaining(
        loaded.cards,
        new Date(INITIAL_NOW),
        INTENSITY_SETTINGS[loadedStudyPlan.plan.intensity].newCardsPerDay,
      ),
      INTENSITY_SETTINGS[loadedStudyPlan.plan.intensity].reviewLimit,
    ),
  )
  const [newCardLimitOverrideDay, setNewCardLimitOverrideDay] = useState<string | null>(null)
  const [practiceLoopIds, setPracticeLoopIds] = useState<string[] | null>(null)
  const [practiceLoopIndex, setPracticeLoopIndex] = useState(0)
  const [practiceLoopDay, setPracticeLoopDay] = useState<string | null>(null)
  const [savingError, setSavingError] = useState<string | null>(null)
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false)
  const [studyPlanOpen, setStudyPlanOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [struggledWith, setStruggledWith] = useState<RecallField[]>([])
  const [studyMode, setStudyMode] = useState<ReviewMode>('recall')
  const [learnOpen, setLearnOpen] = useState(false)
  const [learnSettingsOpen, setLearnSettingsOpen] = useState(false)
  const [learningReviewId, setLearningReviewId] = useState<string | null>(null)
  const [studyTag, setStudyTag] = useState('')
  const [choiceFeedback, setChoiceFeedback] = useState<ChoiceFeedback | null>(null)
  const [productionAnswer, setProductionAnswer] = useState('')
  const [productionFeedback, setProductionFeedback] = useState<ProductionFeedback | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const deckMenu = useRef<HTMLDetailsElement>(null)
  const handleAccountUserChange = useCallback((user: AccountUser | null) => {
    const nextIdentity = user?.email ?? null
    if (accountIdentity.current !== nextIdentity) {
      accountIdentity.current = nextIdentity
      setAccountSyncReady(false)
      setAccountSyncError(null)
      setAccountSyncStatus(user ? 'Loading saved progress…' : null)
      accountRevision.current = 0
    }
    setAccountUser(user)
  }, [])
  const intensitySettings = INTENSITY_SETTINGS[studyPlan.intensity]
  const goalEstimate = estimateGoalPace(studyPlan, new Date(now))
  const scopedCards = useMemo(
    () => getCardsForStudySet(cards, studyTag),
    [cards, studyTag],
  )
  const studyProgress = useMemo(() => getStudySetProgress(scopedCards), [scopedCards])
  const accountSyncMessage =
    accountUser && accountSyncReady && (!canSave || studyPlanWarning)
      ? 'Progress sync is paused until saved data can be read.'
      : accountSyncError ?? accountSyncStatus

  const saveDeck = (nextCards: Card[], failureMessage = 'Your browser could not save this review. Check available device storage.') => {
    if (!canSave) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextCards))
      localStorage.setItem(LOCAL_PROGRESS_UPDATED_AT_KEY, nowIso())
      setSavingError(null)
    } catch {
      setSavingError(failureMessage)
    }
  }

  useEffect(() => {
    localProgressRef.current = { cards, studyPlan, canSave, studyPlanWarning }
  }, [cards, studyPlan, canSave, studyPlanWarning])

  useEffect(() => {
    if (!accountEmail) return

    let active = true

    const loadCloudProgress = async () => {
      const local = localProgressRef.current
      if (!local.canSave || local.studyPlanWarning) {
        throw new Error('Cloud sync is paused because saved data on this device could not be read safely.')
      }

      const response = await fetch('/api/progress')
      const body = await readApiResponse(response)
      if (
        !body ||
        typeof body !== 'object' ||
        !('progress' in body) ||
        !('revision' in body) ||
        typeof body.revision !== 'number' ||
        !Number.isInteger(body.revision) ||
        body.revision < 0
      ) {
        throw new Error('The account server returned invalid progress data.')
      }
      if (!active) return
      accountRevision.current = body.revision
      const remote = body.progress
      if (remote === null) return
      if (!isCloudProgress(remote)) {
        throw new Error('Cloud progress could not be validated. Your local deck was left unchanged.')
      }

      const localPlanUpdatedAt = localStorage.getItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY)
      const remotePlanUpdatedAt = remote.studyPlanUpdatedAt ?? remote.updatedAt
      const localPlanDate = Date.parse(localPlanUpdatedAt ?? '')
      const remotePlanDate = Date.parse(remotePlanUpdatedAt)
      const hasSavedLocalPlan = Boolean(localStorage.getItem(STUDY_PLAN_STORAGE_KEY))
      const preferLocalPlan = Number.isFinite(localPlanDate) && localPlanDate > remotePlanDate
        ? true
        : !Number.isFinite(localPlanDate) && !remote.studyPlanUpdatedAt && hasSavedLocalPlan
      const merged = mergeAccountProgress(
        { cards: local.cards, studyPlan: local.studyPlan },
        remote,
        preferLocalPlan,
      )
      const mergedPlanUpdatedAt = preferLocalPlan
        ? localPlanUpdatedAt ?? nowIso()
        : remotePlanUpdatedAt

      setCards(merged.cards)
      setStudyPlan(merged.studyPlan)
      setCanSave(true)
      setStorageWarning(null)
      setStudyPlanWarning(null)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.cards))
        localStorage.setItem(STUDY_PLAN_STORAGE_KEY, JSON.stringify(merged.studyPlan))
        localStorage.setItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY, mergedPlanUpdatedAt)
        localStorage.setItem(LOCAL_PROGRESS_UPDATED_AT_KEY, nowIso())
        setSavingError(null)
      } catch {
        setSavingError('Cloud progress loaded, but could not be saved to this device.')
      }
    }

    loadCloudProgress()
      .then(() => {
        if (active) {
          setAccountSyncReady(true)
          setAccountSyncStatus('Progress sync is ready.')
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setAccountSyncError(error instanceof Error ? error.message : 'Could not load cloud progress.')
          setAccountSyncStatus(null)
        }
      })

    return () => {
      active = false
    }
  }, [accountEmail])

  useEffect(() => {
    if (!accountEmail || !accountSyncReady || !canSave || studyPlanWarning) return

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setAccountSyncStatus('Syncing progress…')
      setAccountSyncError(null)
      try {
        let studyPlanUpdatedAt = localStorage.getItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY)
        if (!studyPlanUpdatedAt) {
          studyPlanUpdatedAt = nowIso()
          localStorage.setItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY, studyPlanUpdatedAt)
        }
        const response = await fetch('/api/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards,
            studyPlan,
            studyPlanUpdatedAt,
            expectedRevision: accountRevision.current,
          }),
          signal: controller.signal,
        })
        if (response.status === 409) {
          const latestResponse = await fetch('/api/progress', { signal: controller.signal })
          const latestBody = await readApiResponse(latestResponse)
          if (
            !latestBody ||
            typeof latestBody !== 'object' ||
            !('progress' in latestBody) ||
            !('revision' in latestBody) ||
            typeof latestBody.revision !== 'number' ||
            !Number.isInteger(latestBody.revision) ||
            !isCloudProgress(latestBody.progress)
          ) {
            throw new Error('The latest cloud progress could not be validated.')
          }

          const remote = latestBody.progress
          const localPlanUpdatedAt = localStorage.getItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY)
          const remotePlanUpdatedAt = remote.studyPlanUpdatedAt ?? remote.updatedAt
          const localPlanDate = Date.parse(localPlanUpdatedAt ?? '')
          const preferLocalPlan = Number.isFinite(localPlanDate)
            ? localPlanDate > Date.parse(remotePlanUpdatedAt)
            : false
          const merged = mergeAccountProgress(
            { cards, studyPlan },
            remote,
            preferLocalPlan,
          )
          const mergedPlanUpdatedAt = preferLocalPlan
            ? localPlanUpdatedAt ?? nowIso()
            : remotePlanUpdatedAt
          setCards(merged.cards)
          setStudyPlan(merged.studyPlan)
          accountRevision.current = latestBody.revision
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.cards))
            localStorage.setItem(STUDY_PLAN_STORAGE_KEY, JSON.stringify(merged.studyPlan))
            localStorage.setItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY, mergedPlanUpdatedAt)
            localStorage.setItem(LOCAL_PROGRESS_UPDATED_AT_KEY, nowIso())
          } catch {
            setSavingError('Cloud progress was merged, but could not be saved to this device.')
          }
          setAccountSyncStatus('Merged progress from another device.')
          return
        }

        const body = await readApiResponse(response)
        if (!body || typeof body !== 'object' || !('revision' in body) || typeof body.revision !== 'number') {
          throw new Error('The account server returned an invalid sync response.')
        }
        accountRevision.current = body.revision
        setAccountSyncStatus('Progress synced.')
      } catch (error) {
        if (controller.signal.aborted) return
        setAccountSyncError(error instanceof Error ? error.message : 'Could not sync progress.')
        setAccountSyncStatus(null)
      }
    }, 900)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [accountEmail, accountSyncReady, canSave, cards, studyPlan, studyPlanWarning])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentNow = Date.now()
      setNow(currentNow)
      if (practiceLoopIds && practiceLoopDay !== getLocalDayKey(new Date(currentNow))) {
        setPracticeLoopIds(null)
        setPracticeLoopIndex(0)
        setPracticeLoopDay(null)
      }
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [practiceLoopDay, practiceLoopIds])

  const queue = useMemo(() => {
    const sessionSet = new Set(sessionIds)
    return cards
      .filter(
        (card) =>
          sessionSet.has(card.id) &&
          card.status === 'active' &&
          (card.lastReviewedAt === null || new Date(card.dueAt).getTime() <= now),
      )
      .sort((a, b) => {
        const aNew = a.lastReviewedAt === null
        const bNew = b.lastReviewedAt === null
        if (aNew !== bNew) return aNew ? 1 : -1
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
      })
  }, [cards, now, sessionIds])

  const choiceScore = studyProgress.choice
  const productionScore = studyProgress.production
  const feedbackCardId = choiceFeedback?.cardId ?? productionFeedback?.cardId
  const feedbackCard = feedbackCardId
    ? cards.find((card) => card.id === feedbackCardId)
    : undefined
  const practiceLoopActive =
    practiceLoopIds !== null &&
    practiceLoopDay === getLocalDayKey(new Date(now))
  const practiceLoopCard = practiceLoopActive
    ? cards.find((card) => card.id === practiceLoopIds[practiceLoopIndex] && card.status === 'active')
    : undefined
  const learningReviewCard = learningReviewId
    ? cards.find((card) => card.id === learningReviewId && card.status === 'active' && card.lastReviewedAt === null)
    : undefined
  const activeCard = feedbackCard ?? learningReviewCard ?? practiceLoopCard ?? queue[0]
  const hasQuizFeedback = Boolean(choiceFeedback || productionFeedback)
  const visibleQueueCount = practiceLoopActive
    ? practiceLoopIds.length - practiceLoopIndex
    : queue.length + Number(hasQuizFeedback)
  const choiceQuestionIndex = practiceLoopActive
    ? practiceLoopIndex
    : Math.max(0, choiceScore.answered - Number(Boolean(choiceFeedback)))
  const choiceSelection = activeCard
    ? getStudySetChoiceOptions(activeCard, scopedCards, cards, choiceQuestionIndex)
    : { options: [], usedDeckFallback: false }
  const choiceOptions = choiceSelection.options
  const weakPattern = useMemo(() => detectWeakPattern(cards), [cards])
  const promptWord =
    activeCard?.article && activeCard.prompt.startsWith(`${activeCard.article} `)
      ? activeCard.prompt.slice(activeCard.article.length + 1)
      : activeCard?.prompt
  const promptHint = activeCard?.article
    ? 'Think of the article, plural, and meaning.'
    : 'Think of the meaning and how it works in a sentence.'
  const unseenCardsRemaining = scopedCards.filter(
    (card) => card.lastReviewedAt === null,
  ).length
  const dailyNewCardsRemaining = getStudySetNewCardLimit(
    cards,
    scopedCards,
    new Date(now),
    intensitySettings.newCardsPerDay,
  )
  const newCardLimitOverrideActive =
    newCardLimitOverrideDay === getLocalDayKey(new Date(now))
  const newCardsRemaining = newCardLimitOverrideActive
    ? unseenCardsRemaining
    : dailyNewCardsRemaining
  const dailyLimitReached = unseenCardsRemaining > 0 && dailyNewCardsRemaining === 0
  const introducedTodayCards = getCardsIntroducedToday(scopedCards, new Date(now))
  const sessionIdSet = new Set(sessionIds)
  const dueReviewsRemaining = scopedCards.some(
    (card) =>
      card.status === 'active' &&
      card.lastReviewedAt !== null &&
      new Date(card.dueAt).getTime() <= now &&
      !sessionIdSet.has(card.id),
  )
  const getNewCardLimitForSession = (scope: Card[], at: Date, dailyLimit: number) =>
    newCardLimitOverrideDay === getLocalDayKey(at)
      ? scope.filter((card) => card.lastReviewedAt === null).length
      : getStudySetNewCardLimit(cards, scope, at, dailyLimit)

  const handleRating = (rating: Rating) => {
    if (!activeCard || !revealed || studyMode !== 'recall') return
    if (practiceLoopActive) {
      advancePracticeLoop()
      return
    }

    const reviewedAt = new Date(nowIso())
    const updatedCards = cards.map((card) =>
      card.id === activeCard.id
        ? reviewLearningCard(card, rating, reviewedAt, struggledWith)
        : card,
    )
    setCards(updatedCards)
    saveDeck(updatedCards)
    setRevealed(false)
    setLearningReviewId(null)
    setStruggledWith([])
  }

  const handleChoice = (selectedId: string) => {
    if (!activeCard || choiceFeedback || choiceOptions.length !== 4) return
    const correct = selectedId === activeCard.id
    if (practiceLoopActive) {
      setChoiceFeedback({ cardId: activeCard.id, selectedId, correct })
      return
    }
    const reviewedAt = new Date()
    const updatedCards = cards.map((card) =>
      card.id === activeCard.id
        ? reviewLearningCard(card, correct ? 'hard' : 'again', reviewedAt, [], 'choice', correct)
        : card,
    )
    setCards(updatedCards)
    saveDeck(updatedCards)
    setChoiceFeedback({ cardId: activeCard.id, selectedId, correct })
    setLearningReviewId(null)
  }

  const handleProductionSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!activeCard || studyMode !== 'production' || productionFeedback) return
    const answer = productionAnswer.trim()
    if (!answer) return

    const correct = isProductionAnswerCorrect(answer, activeCard.prompt)
    if (practiceLoopActive) {
      setProductionFeedback({ cardId: activeCard.id, answer, correct })
      setProductionAnswer('')
      return
    }
    const reviewedAt = new Date()
    const updatedCards = cards.map((card) =>
      card.id === activeCard.id
        ? reviewLearningCard(card, correct ? 'hard' : 'again', reviewedAt, [], 'production', correct)
        : card,
    )
    setCards(updatedCards)
    saveDeck(updatedCards)
    setProductionFeedback({ cardId: activeCard.id, answer, correct })
    setLearningReviewId(null)
    setProductionAnswer('')
  }

  const continueQuiz = () => {
    setChoiceFeedback(null)
    setProductionFeedback(null)
    setProductionAnswer('')
    setStruggledWith([])
  }

  const advancePracticeLoop = () => {
    if (!practiceLoopIds?.length) return
    setPracticeLoopIndex((index) => (index + 1) % practiceLoopIds.length)
    setRevealed(false)
    continueQuiz()
  }

  const startTodayReviewLoop = () => {
    const ids = introducedTodayCards.map((card) => card.id)
    if (ids.length === 0) return
    setPracticeLoopIds(ids)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(getLocalDayKey(new Date()))
    setRevealed(false)
    continueQuiz()
    setNow(Date.now())
  }

  const stopTodayReviewLoop = () => {
    setPracticeLoopIds(null)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(null)
    setRevealed(false)
    continueQuiz()
    if (deckMenu.current) deckMenu.current.open = false
    setNow(Date.now())
  }

  const toggleStruggle = (field: RecallField) => {
    setStruggledWith((current) =>
      current.includes(field)
        ? current.filter((value) => value !== field)
        : [...current, field],
    )
  }

  const handleAddCard = (input: NewCardInput) => {
    const id = crypto.randomUUID()
    const prompt = input.article ? `${input.article} ${input.word}` : input.word
    const userTags = input.tags
      .split('|')
      .map((tag) => tag.trim())
      .filter(Boolean)
    const card = makeCard(
      id,
      prompt,
      input.meaning,
      input.example,
      input.translation,
      input.category,
      [...new Set([input.level, input.category, ...userTags])],
      input.category === 'noun'
        ? { article: input.article, plural: input.plural || undefined }
        : {},
    )
    const updatedCards = [...cards, card]
    setCards(updatedCards)
    saveDeck(updatedCards)
    setAddCardOpen(false)
    setNotice(canSave
      ? `${prompt} is ready for your next study set.`
      : `${prompt} was added in this session, but cannot be saved until you start with the starter pack.`)
  }

  const handleExportDeck = () => {
    const backup = {
      format: 'deutsch-daily-deck',
      version: DECK_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      cards,
    }
    const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `deutsch-deck-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setNotice('Deck backup downloaded.')
  }

  const mergeImportedCards = (incoming: Card[], kind: 'backup' | 'vocabulary') => {
    const knownIds = new Set(cards.map((card) => card.id))
    const knownContent = new Set(cards.map(cardContentKey))
    const additions = incoming.filter((card) => {
      const contentKey = cardContentKey(card)
      if (knownIds.has(card.id) || knownContent.has(contentKey)) return false
      knownIds.add(card.id)
      knownContent.add(contentKey)
      return true
    })
    const merged = [...cards, ...additions]
    setCards(merged)
    saveDeck(merged)
    setNotice(
      additions.length
        ? canSave
          ? `Imported ${additions.length} ${kind === 'vocabulary' ? 'new words' : additions.length === 1 ? 'card' : 'cards'}. Existing cards were kept.`
          : `Added ${additions.length} cards for this session only. Start with the starter pack to save a fresh deck.`
        : 'No new cards found. Existing cards were kept.',
    )
  }

  const addStarterPackToDeck = () => {
    try {
      const { cards: incoming, kind } = parseDeckFile(
        JSON.stringify(starterPack),
        'open-starter-pack.json',
      )
      mergeImportedCards(incoming, kind)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add the starter vocabulary pack.')
    }
  }

  const handleImportDeck = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    try {
      const { cards: incoming, kind } = parseDeckFile(await file.text(), file.name)

      mergeImportedCards(incoming, kind)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not read that deck file.')
    }
  }

  const startNextSession = () => {
    const nextNow = new Date()
    setSessionIds(
      getSessionCardIds(
        scopedCards,
        nextNow,
        getNewCardLimitForSession(scopedCards, nextNow, intensitySettings.newCardsPerDay),
        intensitySettings.reviewLimit,
      ),
    )
    setPracticeLoopIds(null)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(null)
    setRevealed(false)
    continueQuiz()
    setNow(nextNow.getTime())
  }

  const continueBeyondDailyLimit = () => {
    const nextNow = new Date()
    setNewCardLimitOverrideDay(getLocalDayKey(nextNow))
    setSessionIds(
      getSessionCardIds(
        scopedCards,
        nextNow,
        unseenCardsRemaining,
        intensitySettings.reviewLimit,
      ),
    )
    setRevealed(false)
    continueQuiz()
    setNow(nextNow.getTime())
  }

  const startWithStarterPack = () => {
    const fresh = createSeedDeck()
    setCards(fresh)
    setStudyTag('')
    setCanSave(true)
    setStorageWarning(null)
    setNewCardLimitOverrideDay(null)
    setPracticeLoopIds(null)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(null)
    setSessionIds(
      getSessionCardIds(
        fresh,
        new Date(),
        getStudySetNewCardLimit(
          fresh,
          fresh,
          new Date(),
          intensitySettings.newCardsPerDay,
        ),
        intensitySettings.reviewLimit,
      ),
    )
    setRevealed(false)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
      localStorage.setItem(LOCAL_PROGRESS_UPDATED_AT_KEY, nowIso())
      setSavingError(null)
    } catch {
      setSavingError('Your browser could not save the starter pack. Check available device storage.')
    }
  }

  const shortDueCard = scopedCards
    .filter(
      (card) =>
        card.status === 'active' &&
        card.lastRating === 'again' &&
        new Date(card.dueAt).getTime() > now,
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]
  const nextDueCard = scopedCards
    .filter(
      (card) =>
        card.status === 'active' &&
        card.lastReviewedAt !== null &&
        new Date(card.dueAt).getTime() > now,
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]
  const setMode = (mode: ReviewMode) => {
    setLearnOpen(false)
    setLearnSettingsOpen(false)
    setStudyMode(mode)
    continueQuiz()
    setRevealed(false)
  }

  const handleStudyTagChange = (tag: string) => {
    const nextScope = getCardsForStudySet(cards, tag)
    const nextNow = new Date()
    setStudyTag(tag)
    setSessionIds(
      getSessionCardIds(
        nextScope,
        nextNow,
        getNewCardLimitForSession(nextScope, nextNow, intensitySettings.newCardsPerDay),
        intensitySettings.reviewLimit,
      ),
    )
    setRevealed(false)
    setPracticeLoopIds(null)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(null)
    continueQuiz()
    setNow(nextNow.getTime())
  }

  const handleSaveStudyPlan = (plan: StudyPlan) => {
    setStudyPlan(plan)
    setStudyPlanOpen(false)
    const nextNow = new Date()
    setSessionIds(
      getSessionCardIds(
        scopedCards,
        nextNow,
        getNewCardLimitForSession(
          scopedCards,
          nextNow,
          INTENSITY_SETTINGS[plan.intensity].newCardsPerDay,
        ),
        INTENSITY_SETTINGS[plan.intensity].reviewLimit,
      ),
    )
    setRevealed(false)
    setChoiceFeedback(null)
    setStruggledWith([])
    const planUpdatedAt = nowIso()
    try {
      localStorage.setItem(STUDY_PLAN_STORAGE_KEY, JSON.stringify(plan))
      localStorage.setItem(LOCAL_STUDY_PLAN_UPDATED_AT_KEY, planUpdatedAt)
      localStorage.setItem(LOCAL_PROGRESS_UPDATED_AT_KEY, planUpdatedAt)
      setStudyPlanWarning(null)
    } catch {
      setStudyPlanWarning('Your goal was updated for this visit but could not be saved on this device.')
    }
  }

  const openStudyPlan = () => {
    setStudyPlanOpen(true)
    if (deckMenu.current) deckMenu.current.open = false
  }
  const openSessionSettings = () => {
    setSessionSettingsOpen(true)
    if (deckMenu.current) deckMenu.current.open = false
  }
  const openAccountMenu = () => {
    setAccountMenuOpen(true)
    if (deckMenu.current) deckMenu.current.open = false
  }
  const openLearnSettings = () => {
    setLearnSettingsOpen(true)
    if (deckMenu.current) deckMenu.current.open = false
  }
  const closeLearnSettings = useCallback((restoreFocus = false) => {
    setLearnSettingsOpen(false)
    if (restoreFocus) deckMenu.current?.querySelector('summary')?.focus()
  }, [])

  const studyPlanSummary = `Goal: ${studyPlan.targetLevel} · ${goalEstimate.daysRemaining} days · ${intensitySettings.label} · up to ${intensitySettings.newCardsPerDay} new cards/day`
  const saveLearningCard = (id: string) => {
    if (!canSave) return
    const at = new Date()
    const updatedCards = cards.map((card) => card.id === id
      ? saveForLearning(card, at)
      : card)
    setCards(updatedCards)
    saveDeck(updatedCards, 'Your browser could not save your learning progress. Check available device storage and try again.')
  }
  const startLearningReview = (id: string, mode: ReviewMode, beyondLimit: boolean) => {
    const card = cards.find((item) => item.id === id && item.status === 'active' && item.lastReviewedAt === null)
    if (!card) return
    if (!card.learning?.saved) saveLearningCard(id)
    if (beyondLimit) setNewCardLimitOverrideDay(getLocalDayKey(new Date()))
    setPracticeLoopIds(null)
    setPracticeLoopIndex(0)
    setPracticeLoopDay(null)
    setSessionIds((ids) => ids.includes(id) ? ids : [...ids, id])
    setLearningReviewId(id)
    setStudyMode(mode)
    setRevealed(false)
    continueQuiz()
    setLearnOpen(false)
    setLearnSettingsOpen(false)
  }
  const learnContent = learnOpen && (
    <LearnMode
      cards={cards}
      initialTag={studyTag}
      dailyLimitReached={!newCardLimitOverrideActive && getNewCardQuotaRemaining(cards, new Date(now), intensitySettings.newCardsPerDay) === 0}
      canSave={canSave}
      savingError={savingError}
      settingsOpen={learnSettingsOpen}
      onCloseSettings={closeLearnSettings}
      onSave={saveLearningCard}
      onReview={startLearningReview}
    />
  )

  if (!activeCard && !learnOpen) {
    return (
      <main className="app-shell empty-state-shell">
        <header className="app-header">
          <a className="wordmark" href="/" aria-label="Deutsch Deck home">
            <span className="wordmark-mark">d</span>
            <span>deutsch deck</span>
          </a>
          <div className="header-actions">
            <button type="button" className="add-card-button" onClick={() => setAddCardOpen(true)}>
              <span aria-hidden="true">+</span> Add a word
            </button>
            <AccountMenu
              onUserChange={handleAccountUserChange}
              onOpenChange={setAccountMenuOpen}
              open={accountMenuOpen}
              syncStatus={accountSyncMessage}
            />
            <details className="deck-menu" ref={deckMenu}>
              <summary aria-label="Deck backup options">···</summary>
              <div className="deck-menu-popover">
                <button type="button" onClick={openAccountMenu}>
                  {accountUser ? 'Account settings' : 'Account'}
                </button>
                <button type="button" onClick={handleExportDeck}>Download backup</button>
                <button type="button" onClick={openSessionSettings}>Tune session</button>
                <button type="button" onClick={openStudyPlan}>Adjust goal and pace</button>
                {practiceLoopIds && (
                  <button type="button" onClick={stopTodayReviewLoop}>Stop today’s review loop</button>
                )}
                <button type="button" onClick={addStarterPackToDeck}>
                  Add {starterPack.cards.length} open starter words
                </button>
                <button type="button" onClick={() => importInput.current?.click()}>
                  Import vocabulary or backup
                </button>
                <a href="/deck-template.csv" download>Get spreadsheet template</a>
                <a href="/deck-template.json" download>Get JSON template</a>
                <p>Vocabulary imports start fresh; backups keep review history. Existing words are skipped.</p>
              </div>
            </details>
          </div>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json,text/csv,.csv"
            aria-hidden="true"
            tabIndex={-1}
            hidden
            onChange={handleImportDeck}
          />
        </header>
        {(storageWarning || savingError || studyPlanWarning) && (
          <div className="storage-warning" role="status">
            <p>{storageWarning ?? savingError ?? studyPlanWarning}</p>
            {storageWarning && (
              <button type="button" onClick={startWithStarterPack}>Use the starter vocabulary pack</button>
            )}
          </div>
        )}
        <div className="empty-state">
          <button type="button" className="quiet-button" onClick={() => setLearnOpen(true)}>Learn new words</button>
          <span className="complete-mark" aria-hidden="true">✓</span>
          <h1>That’s a good moment to pause.</h1>
          <p className="session-note">
            {dailyLimitReached
              ? 'Your daily new-card pace is complete. More new cards will be ready tomorrow.'
              : nextDueCard
              ? relativeReviewTime(nextDueCard.dueAt, now)
              : 'You’re all caught up for now.'}
          </p>
          <p className="goal-summary">{studyPlanSummary}</p>
          <button type="button" className="quiet-button goal-edit-button" onClick={openStudyPlan}>
            Adjust goal or daily pace
          </button>
          {choiceScore.answered > 0 && (
            <p className="choice-total">
              Recognition score: {choiceScore.correct}/{choiceScore.answered}
            </p>
          )}
          {productionScore.answered > 0 && (
            <p className="choice-total">
              Production score: {productionScore.correct}/{productionScore.answered}
            </p>
          )}
          {weakPattern && (
            <p className="pattern-note" role="status">
              You marked {weakPattern.field} as difficult in {weakPattern.flaggedReviews} of
              {' '}{weakPattern.observations} reviews, across {weakPattern.affectedCards}
              {' '}{weakPattern.affectedCards === 1 ? 'card' : 'cards'}. Keep an eye on it next time.
            </p>
          )}
          {dueReviewsRemaining || newCardsRemaining > 0 ? (
            <button type="button" className="primary-button" onClick={startNextSession}>
              {dueReviewsRemaining ? 'Continue due reviews' : 'Start next set'}
              <span aria-hidden="true">→</span>
              <small>
                {dueReviewsRemaining
                  ? `Up to ${intensitySettings.reviewLimit} reviews`
                  : `${newCardsRemaining} new cards`}
              </small>
            </button>
          ) : shortDueCard ? (
            <button type="button" className="quiet-button" onClick={() => setNow(Date.now())}>
              Check for reviews
            </button>
          ) : unseenCardsRemaining > 0 ? null : (
            <p className="session-note">Come back when your next cards are due.</p>
          )}
          {(dailyLimitReached || introducedTodayCards.length > 0) && (
            <section className="daily-options" aria-label="More practice options">
              {dailyLimitReached && (
                <>
                  <p>Your new-word target is complete. You can stop here or keep going at your own pace.</p>
                  <button type="button" className="primary-button" onClick={continueBeyondDailyLimit}>
                    Continue beyond today’s target
                    <small>{unseenCardsRemaining} unseen {unseenCardsRemaining === 1 ? 'word' : 'words'} available</small>
                  </button>
                </>
              )}
              {introducedTodayCards.length > 0 && (
                <button type="button" className="quiet-button" onClick={startTodayReviewLoop}>
                  Review today’s {introducedTodayCards.length} {introducedTodayCards.length === 1 ? 'word' : 'words'} again
                  <small>Repeat loop · no schedule changes</small>
                </button>
              )}
            </section>
          )}
          {storageWarning && (
            <button type="button" className="quiet-button reset-button" onClick={startWithStarterPack}>
              Start fresh with starter vocabulary
            </button>
          )}
        </div>
        {notice && <p className="action-notice" role="status">{notice}</p>}
        <p className="privacy-note">
          {accountUser ? 'Your progress is saved on this device and synced to your account.' : 'Your progress stays on this device.'}
        </p>
        {addCardOpen && (
          <AddCardDialog
            defaultTag={studyTag}
            onClose={() => setAddCardOpen(false)}
            onSave={handleAddCard}
          />
        )}
        {studyPlanOpen && (
          <StudyPlanDialog
            initialPlan={studyPlan}
            now={new Date(now)}
            onClose={() => setStudyPlanOpen(false)}
            onSave={handleSaveStudyPlan}
          />
        )}
        {sessionSettingsOpen && (
          <SessionSettingsDialog
            cards={cards}
            tag={studyTag}
            goalSummary={studyPlanSummary}
            onChange={handleStudyTagChange}
            onAdjustGoal={() => {
              setSessionSettingsOpen(false)
              setStudyPlanOpen(true)
            }}
            onClose={() => setSessionSettingsOpen(false)}
          />
        )}
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="Deutsch Deck home">
          <span className="wordmark-mark">d</span>
          <span>deutsch deck</span>
        </a>
        <div className="header-actions">
          <button type="button" className="add-card-button" onClick={() => setAddCardOpen(true)}>
            <span aria-hidden="true">+</span> Add a word
          </button>
          <AccountMenu
            onUserChange={handleAccountUserChange}
            onOpenChange={setAccountMenuOpen}
            open={accountMenuOpen}
            syncStatus={accountSyncMessage}
          />
          <details className="deck-menu" ref={deckMenu}>
            <summary aria-label="Deck and study options">···</summary>
            <div className="deck-menu-popover">
              {learnOpen && (
                <button type="button" onClick={openLearnSettings}>Learn settings</button>
              )}
              <button type="button" onClick={openAccountMenu}>
                {accountUser ? 'Account settings' : 'Account'}
              </button>
              <button type="button" onClick={handleExportDeck}>Download backup</button>
              <button type="button" onClick={openSessionSettings}>Tune session</button>
              <button type="button" onClick={openStudyPlan}>Adjust goal and pace</button>
              {practiceLoopIds && (
                <button type="button" onClick={stopTodayReviewLoop}>Stop today’s review loop</button>
              )}
              <button type="button" onClick={addStarterPackToDeck}>
                Add {starterPack.cards.length} open starter words
              </button>
              <button type="button" onClick={() => importInput.current?.click()}>
                Import vocabulary or backup
              </button>
              <a href="/deck-template.csv" download>Get spreadsheet template</a>
              <a href="/deck-template.json" download>Get JSON template</a>
              <p>Vocabulary imports start fresh; backups keep review history. Existing words are skipped.</p>
            </div>
          </details>
        </div>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json,text/csv,.csv"
          aria-hidden="true"
          tabIndex={-1}
          hidden
          onChange={handleImportDeck}
        />
      </header>

      {(storageWarning || savingError || studyPlanWarning) && (
        <div className="storage-warning" role="status">
          <p>{storageWarning ?? savingError ?? studyPlanWarning}</p>
          {storageWarning && (
            <button type="button" onClick={startWithStarterPack}>Use the starter vocabulary pack</button>
          )}
        </div>
      )}

      <div className="study-mode-toggle" role="group" aria-label="Study mode">
        <button type="button" className={learnOpen ? 'selected' : ''} aria-pressed={learnOpen} onClick={() => setLearnOpen(true)}>Learn</button>
        <button
          type="button"
          className={!learnOpen && studyMode === 'recall' ? 'selected' : ''}
          aria-pressed={!learnOpen && studyMode === 'recall'}
          onClick={() => setMode('recall')}
        >
          Recall
        </button>
        <button
          type="button"
          className={!learnOpen && studyMode === 'production' ? 'selected' : ''}
          aria-pressed={!learnOpen && studyMode === 'production'}
          onClick={() => setMode('production')}
        >
          Produce
        </button>
        <button
          type="button"
          className={!learnOpen && studyMode === 'choice' ? 'selected' : ''}
          aria-pressed={!learnOpen && studyMode === 'choice'}
          onClick={() => setMode('choice')}
        >
          Choose
        </button>
      </div>
      {notice && <p className="action-notice" role="status">{notice}</p>}
      {learnOpen ? learnContent : activeCard && (
        <>

      <div className="deck-shell">
        <div className="card card-back card-back-3" aria-hidden="true" />
        <div className="card card-back card-back-2" aria-hidden="true" />
        <div
          key={activeCard.id}
          className={`flashcard ${revealed ? 'revealed' : ''}`}
        >
          <div className="card-header">
            <span className="tag">{activeCard.category}</span>
            <span className="progress">
              {practiceLoopActive
                ? `Loop ${practiceLoopIndex + 1}/${practiceLoopIds?.length ?? 0}`
                : `${visibleQueueCount} left`}
            </span>
          </div>

          {studyMode === 'recall' ? (
            <>
              <button
                type="button"
                className="card-face"
                onClick={() => setRevealed((value) => !value)}
                aria-label={revealed ? 'Hide answer' : `Reveal answer for ${promptWord}`}
                aria-pressed={revealed}
              >
                {!revealed ? (
                  <div className="card-front">
                    <p className="prompt-label">German</p>
                    <h2 lang="de">{promptWord}</h2>
                    <span className="tap-hint">
                      {promptHint} Tap to reveal <span aria-hidden="true">↗</span>
                    </span>
                  </div>
                ) : (
                  <div className="card-back-content">
                    <p className="answer-word" lang="de">{activeCard.prompt}</p>
                    <div className="answer-meaning">
                      <span className="label">Meaning</span>
                      <strong>{activeCard.meaning}</strong>
                    </div>
                    {activeCard.article && (
                      <div className="fact-row">
                        <span className="label">Article</span>
                        <strong>{activeCard.article}</strong>
                      </div>
                    )}
                    {activeCard.plural && (
                      <div className="fact-row">
                        <span className="label">Plural</span>
                        <strong>{activeCard.plural}</strong>
                      </div>
                    )}
                    <div className="fact-row example-row">
                      <span className="label">In a sentence</span>
                      <strong lang="de">{activeCard.example}</strong>
                      {activeCard.translation && (
                        <span className="translation">{activeCard.translation}</span>
                      )}
                    </div>
                  </div>
                )}
              </button>
              {revealed && (
                <details className="recall-markers">
                  <summary>What felt tricky?</summary>
                  <div className="recall-options" role="group" aria-label="Details that were difficult">
                    {[
                      ...(activeCard.article ? [{ field: 'article' as const, label: 'Article' }] : []),
                      ...(activeCard.plural ? [{ field: 'plural' as const, label: 'Plural' }] : []),
                      { field: 'meaning' as const, label: 'Meaning' },
                      { field: 'context' as const, label: 'Example' },
                    ].map(({ field, label }) => (
                      <label
                        key={field}
                        className={struggledWith.includes(field) ? 'recall-option selected' : 'recall-option'}
                      >
                        <input
                          type="checkbox"
                          checked={struggledWith.includes(field)}
                          onChange={() => toggleStruggle(field)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : studyMode === 'choice' && choiceFeedback ? (
            <div className="choice-result" aria-live="polite">
              <p className={choiceFeedback.correct ? 'choice-result-title correct' : 'choice-result-title incorrect'}>
                {choiceFeedback.correct
                  ? practiceLoopActive ? 'Correct — nice recall.' : 'Correct — one point.'
                  : 'Not quite — take another look.'}
              </p>
              {!choiceFeedback.correct && (
                <p className="choice-your-answer">
                  Your choice: {choiceOptions.find((option) => option.cardId === choiceFeedback.selectedId)?.prompt}
                </p>
              )}
              <div className="choice-answer">
                <strong lang="de">{activeCard.prompt}</strong>
                <span className="choice-meaning">{activeCard.meaning}</span>
                {activeCard.plural && (
                  <span className="choice-plural">Plural: {activeCard.plural}</span>
                )}
                <p className="choice-example" lang="de">{activeCard.example}</p>
                {activeCard.translation && (
                  <span className="choice-translation">{activeCard.translation}</span>
                )}
              </div>
              <p className="choice-scheduling-note">
                {practiceLoopActive
                  ? 'This repeat loop does not change your schedule or score.'
                  : choiceFeedback.correct
                    ? 'Recognition is useful, but not the same as free recall. This is scheduled as Hard.'
                    : 'This missed item is scheduled for another look in about 10 minutes.'}
              </p>
              {!practiceLoopActive && <StudySetProgressSummary cards={scopedCards} tag={studyTag} />}
            </div>
          ) : studyMode === 'choice' ? (
            <div className="choice-question">
              <div className="choice-prompt">
                <p className="prompt-label">Choose the German word for</p>
                <h2>{activeCard.meaning}</h2>
              </div>
              {choiceOptions.length === 4 ? (
                <>
                  {choiceSelection.usedDeckFallback && (
                    <p className="choice-set-note">
                      This lesson has fewer than four distinct choices, so some options are from other study sets.
                    </p>
                  )}
                  <div className="choice-options" role="group" aria-label="German word choices">
                    {choiceOptions.map((option, index) => (
                      <button
                        type="button"
                        key={option.cardId}
                        className="choice-option"
                        onClick={() => handleChoice(option.cardId)}
                      >
                        <span className="choice-key">{String.fromCharCode(65 + index)}</span>
                        <span lang="de">{option.prompt}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="choice-unavailable">
                  <p>
                    {choiceSelection.usedDeckFallback
                      ? 'Even the full deck does not have four distinct choices yet.'
                      : 'This set does not have enough distinct choices yet.'}
                    {' '}Add more vocabulary or return to Recall.
                  </p>
                  <button type="button" className="quiet-button" onClick={() => setMode('recall')}>
                    Return to recall
                  </button>
                </div>
              )}
            </div>
          ) : productionFeedback ? (
            <div className="choice-result production-result" aria-live="polite">
              <p className={`choice-result-title ${productionFeedback.correct ? 'correct' : 'incorrect'}`}>
                {productionFeedback.correct ? 'Correct — good retrieval.' : 'Not quite — review this one.'}
              </p>
              <p className="choice-your-answer">
                You typed: <span lang="de">{productionFeedback.answer}</span>
              </p>
              <div className="choice-answer">
                <strong lang="de">{activeCard.prompt}</strong>
                <span className="choice-meaning">{activeCard.meaning}</span>
                {activeCard.plural && (
                  <span className="choice-plural">Plural: {activeCard.plural}</span>
                )}
                <p className="choice-example" lang="de">{activeCard.example}</p>
                {activeCard.translation && (
                  <span className="choice-translation">{activeCard.translation}</span>
                )}
              </div>
              <p className="choice-scheduling-note">
                {practiceLoopActive
                  ? 'This repeat loop does not change your schedule or score.'
                  : productionFeedback.correct
                    ? 'Typed production is scheduled as Hard.'
                    : 'This missed item is scheduled for another look in about 10 minutes.'}
              </p>
            </div>
          ) : (
            <div className="choice-question production-question">
              <div className="choice-prompt">
                <p className="prompt-label">Type the German for</p>
                <h2>{activeCard.meaning}</h2>
              </div>
              <form className="production-answer-form" onSubmit={handleProductionSubmit}>
                <label>
                  German word or phrase
                  <input
                    lang="de"
                    autoComplete="off"
                    autoCapitalize="off"
                    maxLength={200}
                    value={productionAnswer}
                    onChange={(event) => setProductionAnswer(event.target.value)}
                    placeholder={activeCard.article ? 'Include der / die / das' : 'Type your answer'}
                    autoFocus
                  />
                </label>
                <p>For nouns, include the article. Case and extra spaces do not matter.</p>
                <button type="submit" className="primary-button" disabled={!productionAnswer.trim()}>
                  Check answer
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {studyMode === 'recall' ? (
        <>
          {practiceLoopActive ? (
            <button
              type="button"
              className="primary-button choice-next"
              onClick={advancePracticeLoop}
              disabled={!revealed}
            >
              Next word <span aria-hidden="true">→</span>
            </button>
          ) : (
            <>
              {revealed && (
                <p className="rating-prompt" aria-live="polite">How well did you remember it?</p>
              )}
              <div className="rating-toolbar" aria-label="Review rating controls">
                {(['again', 'hard', 'good', 'easy'] as const).map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    className={`rating ${rating}`}
                    onClick={() => handleRating(rating)}
                    disabled={!revealed}
                  >
                    {rating[0].toUpperCase() + rating.slice(1)}
                    <small>{intervalLabel(activeCard, rating, new Date(now))}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      ) : hasQuizFeedback ? (
        <button
          type="button"
          className="primary-button choice-next"
          onClick={practiceLoopActive ? advancePracticeLoop : continueQuiz}
        >
          {practiceLoopActive ? 'Next word' : 'Continue to next card'} <span aria-hidden="true">→</span>
        </button>
      ) : studyMode === 'choice' ? (
        <div className="choice-score" aria-live="polite">
          <strong>
            {practiceLoopActive
              ? `Review loop · ${practiceLoopIndex + 1}/${practiceLoopIds?.length ?? 0}`
              : `Recognition score: ${choiceScore.correct}/${choiceScore.answered}`}
          </strong>
          <span>
            {practiceLoopActive
              ? 'Answers in this loop do not change your schedule or score.'
              : 'Correct choices count as Hard; misses return sooner.'}
          </span>
        </div>
      ) : (
        <div className="choice-score" aria-live="polite">
          <strong>
            {practiceLoopActive
              ? `Review loop · ${practiceLoopIndex + 1}/${practiceLoopIds?.length ?? 0}`
              : `Production score: ${productionScore.correct}/${productionScore.answered}`}
          </strong>
          <span>
            {practiceLoopActive
              ? 'Answers in this loop do not change your schedule or score.'
              : 'Typed answers are case-insensitive; spelling and noun articles matter.'}
          </span>
        </div>
      )}
        </>
      )}
      <p className="privacy-note">
        {accountUser ? 'Your progress is saved on this device and synced to your account.' : 'Your progress stays on this device.'}
      </p>
      {addCardOpen && (
        <AddCardDialog
          defaultTag={studyTag}
          onClose={() => setAddCardOpen(false)}
          onSave={handleAddCard}
        />
      )}
      {studyPlanOpen && (
        <StudyPlanDialog
          initialPlan={studyPlan}
          now={new Date(now)}
          onClose={() => setStudyPlanOpen(false)}
          onSave={handleSaveStudyPlan}
        />
      )}
      {sessionSettingsOpen && (
        <SessionSettingsDialog
          cards={cards}
          tag={studyTag}
          goalSummary={studyPlanSummary}
          onChange={handleStudyTagChange}
          onAdjustGoal={() => {
            setSessionSettingsOpen(false)
            setStudyPlanOpen(true)
          }}
          onClose={() => setSessionSettingsOpen(false)}
        />
      )}
    </main>
  )
}

export default App
