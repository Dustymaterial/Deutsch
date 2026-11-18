import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronLeft, Ellipsis, Inbox, Check, LayoutGridCircles, Languages, Reply, Search, ShieldCheck, SmilePlus, SpellCheck, Users, X } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useFormValidation } from './formValidation'
import { cardContentKey, type Card } from './deckImport'
import { useConfirm } from './confirmContext'
import { findMeaning, findWord, indexMeanings, indexWords, normalizeWord, type WordEntry } from './wordLookup'
import { lookupDictionary, lookupEnglish, type Dictionary } from './dictionaryLookup'
import { loadDictionary } from './dictionaryLoader'
import { MessageWords, type MessageWordTools } from './MessageWords'
import { CorrectionDiff } from './CorrectionDiff'
import { correctionTagLabels, reactionOptions } from './chatOptions'
import { matchSnippet } from './messageSearch'
import { replyColor } from './replyColor'
import { GroupConversation, GroupsSidebar } from './GroupsPanel'
import { MessageActionMenu } from './MessageActionMenu'
import { ReportPopover, type ReportReason } from './ReportPopover'
import { ModerationQueue } from './ModerationQueue'
import { useGroupDirectory } from './groupsApi'
import type { GroupMessage } from './groupsApi'
import { PersistentChatCache, chatCacheClearedKey, chatCacheEnabled, clearChatCache, setChatCacheEnabled } from './chatPersistentCache'
import { useVisibleChatRead } from './useVisibleChatRead'
import { ChatMessageList } from './ChatMessageList'
import { useChatTyping } from './useChatTyping'
import { formatChatTime } from './chatTime'
import { conversationEntryState, isChatOverlayEntry, isConversationEntry, withoutChatOverlay } from './conversationHistory'
import { watchChatChanges } from './chatLive'
import { replayUpdatesInRange } from './chatReplay'
import { useChatScrollState } from './useChatScrollState'
import { useChatOverlayHistory } from './useChatOverlayHistory'
import { leaveChatHistory } from './chatHistoryNavigation'
import { clearCommunityDirectoryCache, getCommunityDirectory, loadCommunityDirectory } from './communityDirectoryCache'
import { CompanionApiError, fetchCompanionDirectory, request } from './companionsApi'
import { loadStarterPack, type StarterEntry, type StarterPack } from './starterDeck'
import { PendingChatMessages } from './PendingChatMessages'
import type { ChatOutbox } from './useChatOutbox'
import { MessageReceipt, type MessageReceiptStatus } from './MessageReceipt'
import { useChatDelivery } from './useChatDelivery'
import { MenuSelect } from './MenuSelect'

type Profile = { id: string; username: string; avatarSeed: string }
type Companion = Profile & {
  status: 'incoming' | 'outgoing' | 'connected' | 'blocked'
  canNudge?: boolean
  nudgeAt?: string
}
type Action = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'
type Reaction = { emoji: string; count: number; mine: boolean }
type ReplyPreview = { id: string; isMine: boolean; text: string }
type Correction = { text?: string; approved?: boolean; tags?: string[]; note?: string; byMe: boolean; createdAt: string; response?: 'thanks' | 'saved' }
type ChatMessage = {
  id: string
  senderId: string
  isMine: boolean
  kind: 'text' | 'word' | 'unsent'
  text: string
  card?: SharedWordPreview['card']
  replyTo?: ReplyPreview
  correction?: Correction
  editedAt?: string
  editableUntil?: string
  reactions: Reaction[]
  createdAt: string
  reported: boolean
  receipt?: MessageReceiptStatus
}
type ChatSummary = {
  id: string
  companion: Profile
  lastMessage: { id?: string; text: string; isMine: boolean; createdAt: string } | null
  unread: boolean
  updatedAt: string
}
type PracticeCard = Pick<Card, 'prompt' | 'article' | 'meaning' | 'plural' | 'example' | 'translation' | 'category'>
type PracticeSession = {
  id: string
  role: 'learner' | 'helper'
  status: 'pending' | 'active' | 'declined' | 'ended' | 'completed'
  total: number
  position?: number
  card?: PracticeCard
  answer?: string
  feedback?: 'try-again' | 'correct' | 'reveal'
}
type PracticeDecision = 'accept' | 'decline' | 'end' | 'try-again' | 'correct' | 'reveal' | 'retry' | 'next'
export type CompanionDirectory = { companions: Companion[]; sharedWords: SharedWordPreview[]; emailsEnabled: boolean; chats: ChatSummary[] }
type SelectedChat = { id: string; companion: Profile }
type SidebarView = 'chats' | 'requests' | 'shared' | 'groups' | 'moderation'

const shareableCategories = new Set(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase'])

const sharedCardPayload = (card: Card) => ({
  prompt: card.prompt,
  ...(card.article ? { article: card.article } : {}),
  meaning: card.meaning,
  ...(card.plural ? { plural: card.plural } : {}),
  example: card.example,
  ...(card.translation ? { translation: card.translation } : {}),
  category: card.category,
})

const wordKey = (card: SharedWordPreview['card']) =>
  [card.category, card.article ?? '', card.prompt, card.meaning].join('|').trim().toLocaleLowerCase('de-DE')

const isShareableCard = (card: Card) =>
  shareableCategories.has(card.category) &&
  (card.category !== 'noun' || ['der', 'die', 'das'].includes(card.article ?? ''))

export type SharedWordPreview = {
  id: string
  card: Pick<Card, 'prompt' | 'article' | 'meaning' | 'plural' | 'example' | 'translation' | 'category'>
  note: string
  sender: Profile
  createdAt: string
}

const normalizeMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  kind: message.kind ?? 'text',
  reactions: Array.isArray(message.reactions) ? message.reactions : [],
})

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]))
  let changed = false
  incoming.map(normalizeMessage).forEach((message) => {
    const previous = messages.get(message.id)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(message)) changed = true
    messages.set(message.id, message)
  })
  if (!changed) return current
  return [...messages.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}

const distinctEntries = (entries: WordEntry[], limit: number) => entries
  .filter((entry, index, all) => all.findIndex((other) => other.prompt === entry.prompt && other.category === entry.category) === index)
  .slice(0, limit)

function CompanionLoader({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`companion-loader${compact ? ' compact' : ''}`} role="status" aria-label={label}><span /></div>
}

function PracticeWaiting({ children }: { children: React.ReactNode }) {
  return <p className="companion-practice-waiting" role="status">{children}<span className="companion-wait-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></p>
}

function CompanionPracticeSession({
  practice, companionName, answer, busy, onAnswerChange, onAnswerBlur, onSubmitAnswer, onDecision,
}: {
  practice: PracticeSession
  companionName: string
  answer: string
  busy: boolean
  onAnswerChange: (value: string) => void
  onAnswerBlur: () => void
  onSubmitAnswer: (event: React.FormEvent<HTMLFormElement>) => void
  onDecision: (decision: PracticeDecision) => void
}) {
  const card = practice.card
  const prompt = card && (card.article ? `${card.article} ${card.prompt}` : card.prompt)
  const waiting = practice.status === 'pending'
  const helping = practice.role === 'helper'
  const revealed = practice.feedback === 'correct' || practice.feedback === 'reveal'

  return <section className="companion-practice-session" aria-label="Review together">
    <div className="deck-shell companion-practice-deck">
      <div className="card card-back card-back-3" aria-hidden="true" />
      <div className="card card-back card-back-2" aria-hidden="true" />
      <article className="flashcard companion-practice-card">
        <header className="card-header">
          <span className="tag">{waiting ? 'Practice' : card?.category ?? 'Practice'}</span>
          <span className="progress">{waiting ? '5 words' : `${practice.position}/${practice.total}`}</span>
        </header>

        {waiting
          ? <div className="card-front companion-practice-card-content">
            <h2>{helping ? `${companionName} asked for your help` : 'Ready to review together'}</h2>
            {helping
              ? <div className="companion-practice-cta">
                <button type="button" className="primary-button" disabled={busy} onClick={() => onDecision('accept')}>Help practise</button>
                <button type="button" className="quiet-button" disabled={busy} onClick={() => onDecision('decline')}>Not now</button>
              </div>
              : <div className="companion-practice-cta">
                <PracticeWaiting>Waiting for {companionName} to join</PracticeWaiting>
                <button type="button" className="quiet-button" disabled={busy} onClick={() => onDecision('end')}>Cancel request</button>
              </div>}
          </div>
          : card && helping
            ? <div className="companion-practice-card-content companion-practice-helper">
              <p className="prompt-label">Ask them to recall</p>
              <h2 lang="de">{prompt}</h2>
              <div className="companion-practice-expected">
                <span className="label">Expected meaning</span>
                <strong>{card.meaning}</strong>
                {card.plural && <span>Plural: <span lang="de">{card.plural}</span></span>}
              </div>
              {practice.answer
                ? <div className="companion-practice-response">
                  <span>{companionName} answered</span>
                  <strong>{practice.answer}</strong>
                </div>
                : <PracticeWaiting>Waiting for their answer</PracticeWaiting>}
              {practice.answer && !practice.feedback && <div className="companion-practice-actions" role="group" aria-label="Respond to answer">
                <button type="button" className="rating good" disabled={busy} onClick={() => onDecision('correct')}><Check size={17} aria-hidden="true" />Correct</button>
                <button type="button" className="rating hard" disabled={busy} onClick={() => onDecision('try-again')}>Try again</button>
                <button type="button" className="rating easy" disabled={busy} onClick={() => onDecision('reveal')}>Reveal</button>
              </div>}
              {practice.feedback && <p className="companion-practice-waiting" role="status">{practice.feedback === 'try-again' ? 'They can try another answer.' : practice.feedback === 'correct' ? 'Marked correct. They can continue when ready.' : 'The answer was revealed. They can continue when ready.'}</p>}
            </div>
            : card && revealed
              ? <div className="card-back-content companion-practice-reveal">
                <p className="answer-word" lang="de">{prompt}</p>
                <div className="answer-meaning"><span className="label">Meaning</span><strong>{card.meaning}</strong></div>
                {card.article && <div className="fact-row"><span className="label">Article</span><strong lang="de">{card.article}</strong></div>}
                {card.plural && <div className="fact-row"><span className="label">Plural</span><strong lang="de">{card.plural}</strong></div>}
                {card.example && <div className="fact-row example-row companion-practice-example">
                  <span className="label">In a sentence</span>
                  <strong lang="de">{card.example}</strong>
                  {card.translation && <span className="translation" lang="en">{card.translation}</span>}
                </div>}
                <p className="companion-practice-feedback" role="status">{practice.feedback === 'correct' ? 'Correct. Nice recall.' : 'Review the answer when ready.'}</p>
              </div>
              : card
                ? <div className="card-front companion-practice-card-content">
                  <p className="prompt-label">What does this mean?</p>
                  <h2 lang="de">{prompt}</h2>
                  {practice.feedback === 'try-again'
                    ? <div className="companion-practice-cta"><p className="companion-practice-feedback" role="status">Not quite yet. Take another look when you are ready.</p><button type="button" className="primary-button" disabled={busy} onClick={() => onDecision('retry')}>Try again</button></div>
                    : practice.answer
                      ? <PracticeWaiting>Waiting for {companionName}’s feedback</PracticeWaiting>
                      : <form className="production-answer-form companion-practice-answer-form" onSubmit={onSubmitAnswer}>
                        <label>English meaning
                          <input value={answer} maxLength={1000} autoComplete="off" onChange={(event) => onAnswerChange(event.target.value)} onBlur={onAnswerBlur} placeholder="Type your answer" />
                        </label>
                        <button type="submit" className="primary-button" disabled={busy || !answer.trim()}>Send answer</button>
                      </form>}
                </div>
                : null}
      </article>
    </div>
    {!waiting && practice.role === 'learner' && revealed && <button type="button" className="primary-button companion-practice-next" disabled={busy} onClick={() => onDecision('next')}>Next word</button>}
    {!waiting && <button type="button" className="quiet-button companion-practice-end" disabled={busy} onClick={() => onDecision('end')}>End practice</button>}
  </section>
}

export function CompanionPanel({
  cards,
  accountId,
  outbox,
  onReceiveWord,
  onAddStarterWord,
  onAddDictionaryWord,
  onNotify,
  onBack,
  invitationToken,
  onInvitationHandled,
}: {
  cards: Card[]
  accountId: string | null
  outbox: ChatOutbox
  onReceiveWord: (share: SharedWordPreview) => 'added' | 'already-present' | false
  onAddStarterWord: (entry: StarterEntry) => 'added' | 'already-present' | false
  onAddDictionaryWord: (entry: WordEntry) => 'added' | 'already-present' | false
  onNotify: (message: string, kind?: 'success' | 'error') => void
  onBack: (conversationEntry: boolean, viewDepth: number) => void
  invitationToken: string | null
  onInvitationHandled: () => void
}) {
  const [initialDirectory] = useState(() => getCommunityDirectory(accountId, 'companions'))
  const [companions, setCompanions] = useState<Companion[]>(initialDirectory?.companions ?? [])
  const [sharedWords, setSharedWords] = useState<SharedWordPreview[]>(initialDirectory?.sharedWords ?? [])
  const [chats, setChats] = useState<ChatSummary[]>(initialDirectory?.chats ?? [])
  const [emailsEnabled, setEmailsEnabled] = useState(initialDirectory?.emailsEnabled ?? true)
  const [cachePreference] = useState(() => {
    try { return { enabled: chatCacheEnabled(), error: null } }
    catch { return { enabled: false, error: 'Could not read the saved chat preference on this device.' } }
  })
  const [persistentCacheEnabled, setPersistentCacheEnabled] = useState(cachePreference.enabled)
  const [cacheProblem, setCacheProblem] = useState<string | null>(cachePreference.error)
  const [loading, setLoading] = useState(!initialDirectory)
  const [loaded, setLoaded] = useState(Boolean(initialDirectory))
  const [busy, setBusy] = useState(false)
  const [sidebarView, setSidebarView] = useState<SidebarView>(() => invitationToken ? 'groups' : 'chats')
  const [username, setUsername] = useState('')
  const [found, setFound] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirmDialog = useConfirm()
  const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(null)
  const [openingChat, setOpeningChat] = useState<Profile | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatTyping, setChatTyping] = useState<{ id: string; typing: boolean } | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [chatUpdating, setChatUpdating] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [messageDraft, setMessageDraft] = useState('')
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  const reportAnchor = useRef<HTMLButtonElement | null>(null)
  const closeReport = useCallback(() => setReportingMessageId(null), [])
  const [reply, setReply] = useState<{ chatId: string; message: ChatMessage } | null>(null)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [wordPickerQuery, setWordPickerQuery] = useState('')
  const [practice, setPractice] = useState<PracticeSession | null>(null)
  const [practiceTag, setPracticeTag] = useState('')
  const [practiceAnswer, setPracticeAnswer] = useState('')
  const [searchFor, setSearchFor] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<{ chatId: string; query: string; messages: ChatMessage[]; hasMore: boolean } | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ messageId: string; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [correcting, setCorrecting] = useState<{ messageId: string; text: string; note: string; tags: string[] } | null>(null)
  const [savingCorrection, setSavingCorrection] = useState<{ messageId: string; meaning: string } | null>(null)
  const [activeWord, setActiveWord] = useState<{ messageId: string; key: string; word: string } | null>(null)
  const [wordChipsFor, setWordChipsFor] = useState<string | null>(null)
  const [dictionary, setDictionary] = useState<Dictionary | null>(null)
  const [dictionaryFailed, setDictionaryFailed] = useState(false)
  const [starterPack, setStarterPack] = useState<StarterPack | null>(null)
  const [starterFailed, setStarterFailed] = useState(false)
  const [shareQuery, setShareQuery] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')
  const [shareNote, setShareNote] = useState('')
  const workspace = useRef<HTMLDivElement>(null)
  const chatStream = useRef<HTMLDivElement>(null)
  const [awayFromBottom, setAwayFromBottom] = useChatScrollState(chatStream, sidebarView === 'chats' ? selectedChat?.id ?? null : null)
  const scrollOnOpen = useRef(false)
  const messageComposer = useRef<HTMLTextAreaElement>(null)
  const shareTools = useRef<HTMLDetailsElement>(null)
  const wordPicker = useRef<HTMLDetailsElement>(null)
  const practicePicker = useRef<HTMLDetailsElement>(null)
  const selectedChatId = useRef<string | null>(null)
  const chatOpenSequence = useRef(0)
  const latestChatRequest = useRef(0)
  const directoryRequest = useRef(0)
  const latestChatInFlight = useRef<{ id: string; sequence: number } | null>(null)
  const olderChatInFlight = useRef<{ id: string; cursor?: string } | null>(null)
  const [messageMenu, setMessageMenu] = useState<string | null>(null)
  const [chatDetailsMenuOpen, setChatDetailsMenuOpen] = useState(false)
  const chatDetailsMenu = useRef<HTMLDetailsElement | null>(null)
  const onChatDetailsToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const target = event.currentTarget
    if (target.open) chatDetailsMenu.current = target
    else if (chatDetailsMenu.current === target) chatDetailsMenu.current = null
    setChatDetailsMenuOpen(Boolean(chatDetailsMenu.current))
  }
  const [privateCache] = useState(() => new PersistentChatCache<ChatMessage>(accountId ?? '', 'private', false,
    (value): value is ChatMessage => Boolean(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      && 'text' in value && typeof value.text === 'string' && 'createdAt' in value && typeof value.createdAt === 'string'
      && Number.isFinite(Date.parse(value.createdAt)) && 'senderId' in value && typeof value.senderId === 'string'
      && 'isMine' in value && typeof value.isMine === 'boolean' && 'reported' in value && typeof value.reported === 'boolean'
      && 'kind' in value && (value.kind === 'text' || value.kind === 'word' || value.kind === 'unsent')
      && 'reactions' in value && Array.isArray(value.reactions)),
    (failure) => setCacheProblem(failure instanceof Error ? `Chat storage is unavailable: ${failure.message}` : 'Chat storage is unavailable.')))
  const [groupCache] = useState(() => new PersistentChatCache<GroupMessage>(accountId ?? '', 'group', false,
    (value): value is GroupMessage => Boolean(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
      && 'text' in value && typeof value.text === 'string' && 'createdAt' in value && typeof value.createdAt === 'string'
      && Number.isFinite(Date.parse(value.createdAt)) && 'isMine' in value && typeof value.isMine === 'boolean'
      && 'reported' in value && typeof value.reported === 'boolean' && 'canHide' in value && typeof value.canHide === 'boolean'
      && 'kind' in value && (value.kind === 'text' || value.kind === 'word' || value.kind === 'unsent' || value.kind === 'hidden' || value.kind === 'system')
      && (value.kind === 'system' || ('reactions' in value && Array.isArray(value.reactions)))),
    (failure) => setCacheProblem(failure instanceof Error ? `Chat storage is unavailable: ${failure.message}` : 'Chat storage is unavailable.')))
  const conversationHistoryEntry = useRef<string | null>(null)
  const sidebarHistory = useRef<{
    base: SidebarView
    active: string | null
    depth: number
    entries: Map<string, { view: SidebarView; depth: number }>
  }>({ base: invitationToken ? 'groups' : 'chats', active: null, depth: 0, entries: new Map() })
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const { directory: groupDirectory, error: groupsError, reload: reloadGroups } = useGroupDirectory(accountId)
  const lastScrolledMessage = useRef<string | null>(null)
  const { errors, validate, handleInput } = useFormValidation()

  useEffect(() => {
    const viewport = window.visualViewport
    const element = workspace.current
    if (!viewport || !element) return
    let workspaceTop = element.getBoundingClientRect().top
    const updateHeight = () => {
      element.style.setProperty('--companion-visual-height', `${Math.round(viewport.height)}px`)
      element.style.setProperty('--companion-available-height', `${Math.max(0, Math.round(viewport.height - workspaceTop))}px`)
    }
    const updatePosition = () => element.style.setProperty('--companion-viewport-offset-top', `${Math.round(viewport.offsetTop)}px`)
    const updateGeometry = () => {
      workspaceTop = element.getBoundingClientRect().top
      updateHeight()
    }
    updateHeight()
    updatePosition()
    viewport.addEventListener('resize', updateHeight)
    viewport.addEventListener('scroll', updatePosition)
    window.addEventListener('resize', updateGeometry)
    return () => {
      viewport.removeEventListener('resize', updateHeight)
      viewport.removeEventListener('scroll', updatePosition)
      window.removeEventListener('resize', updateGeometry)
      element.style.removeProperty('--companion-available-height')
      element.style.removeProperty('--companion-visual-height')
      element.style.removeProperty('--companion-viewport-offset-top')
    }
  }, [])

  const privateOverlay = sidebarView === 'chats' && selectedChat ? [
    reportingMessageId && 'report', savingCorrection && 'save', correcting && 'correct',
    editing && 'edit', reactionPickerFor && 'reaction', messageMenu && 'message-menu', chatDetailsMenuOpen && 'details-menu', activeWord && 'word',
    wordChipsFor && 'words', searchFor === selectedChat.id && 'search',
    reply?.chatId === selectedChat.id && 'reply',
  ].filter(Boolean).join(',') : ''
  useChatOverlayHistory(sidebarView === 'chats' ? selectedChat?.id ?? null : null, privateOverlay, (overlay) => {
    if (overlay === 'report') setReportingMessageId(null)
    else if (overlay === 'save') setSavingCorrection(null)
    else if (overlay === 'correct') setCorrecting(null)
    else if (overlay === 'edit') setEditing(null)
    else if (overlay === 'reaction') setReactionPickerFor(null)
    else if (overlay === 'message-menu') setMessageMenu(null)
    else if (overlay === 'details-menu') { if (chatDetailsMenu.current) chatDetailsMenu.current.open = false; setChatDetailsMenuOpen(false) }
    else if (overlay === 'word') setActiveWord(null)
    else if (overlay === 'words') setWordChipsFor(null)
    else if (overlay === 'search') setSearchFor(null)
    else if (overlay === 'reply') setReply(null)
  })

  const load = useCallback(async (join = false) => {
    const sequence = ++directoryRequest.current
    let data: CompanionDirectory
    try {
      data = await loadCommunityDirectory(accountId, 'companions', fetchCompanionDirectory, join)
    } catch (failure) {
      if (sequence !== directoryRequest.current) return
      throw failure
    }
    if (sequence !== directoryRequest.current) return
    setCompanions(data.companions)
    setSharedWords(data.sharedWords)
    setEmailsEnabled(data.emailsEnabled)
    setChats(data.chats)
    privateCache.retain(new Set(data.chats.map((chat) => chat.id)))
    setError(null)
    setLoaded(true)
  }, [accountId, privateCache])

  const loadMessages = useCallback(async (
    chatId: string,
    mode: 'replace' | 'merge' = 'replace',
    before?: Pick<ChatMessage, 'createdAt' | 'id'>,
    replayCursor?: string,
  ) => {
    if (!before && olderChatInFlight.current?.id === chatId && !replayCursor) return null
    const sequence = chatOpenSequence.current
    const requestSequence = before ? null : ++latestChatRequest.current
    const query = before ? `?before=${encodeURIComponent(before.createdAt)}&beforeId=${encodeURIComponent(before.id)}` : '?read=0'
    const pending = before ? null : { id: chatId, sequence }
    if (pending) latestChatInFlight.current = pending
    const cached = before ? null : privateCache.get(chatId)
    let data: { messages: ChatMessage[]; hasMore: boolean; typing: boolean; cursor?: string | null }
    let replayed = false
    let reset = false
    try {
      const cursor = replayCursor ?? cached?.cursor
      if (cursor && cached) {
        let sync: { reset: boolean; messages?: ChatMessage[]; typing?: boolean; cursor?: string }
        try {
          sync = await request(`/chats/${chatId}/sync?cursor=${encodeURIComponent(cursor)}`) as typeof sync
        } catch (failure) {
          if (!(failure instanceof CompanionApiError) || failure.status !== 503
            || failure.message !== 'Chat replay requires a MongoDB replica set.') throw failure
          sync = { reset: true }
        }
        if (sync.reset === false && Array.isArray(sync.messages) && typeof sync.typing === 'boolean' && typeof sync.cursor === 'string') {
          data = { messages: sync.messages, hasMore: cached.hasMore, typing: sync.typing, cursor: sync.cursor }
          replayed = true
        } else if (sync.reset === true) {
          reset = true
          data = await request(`/chats/${chatId}/messages${query}`) as typeof data
        } else {
          throw new Error('The chat service returned an incomplete replay response.')
        }
      } else {
        reset = !before && mode === 'merge' && !cached
        data = await request(`/chats/${chatId}/messages${query}`) as typeof data
      }
    } catch (failure) {
      if (selectedChatId.current !== chatId || chatOpenSequence.current !== sequence
        || (requestSequence !== null && requestSequence !== latestChatRequest.current)) return null
      throw failure
    } finally {
      if (pending && latestChatInFlight.current === pending) latestChatInFlight.current = null
    }
    if (selectedChatId.current !== chatId || chatOpenSequence.current !== sequence
      || (requestSequence !== null && requestSequence !== latestChatRequest.current)) return null
    if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean' || typeof data.typing !== 'boolean') {
      throw new Error('The chat service returned an incomplete response.')
    }
    if (!before) {
      const updates = data.messages.map(normalizeMessage)
      const messages = replayed && cached ? mergeMessages(cached.messages, replayUpdatesInRange(cached.messages, updates)) : updates
      privateCache.set(chatId, { messages, hasMore: data.hasMore, ...(data.cursor ? { cursor: data.cursor } : {}) })
      setChatTyping({ id: chatId, typing: data.typing })
    }
    setChatMessages((current) => replayed
      ? mergeMessages(current, replayUpdatesInRange(current, data.messages))
      : mode === 'replace' || reset ? data.messages.map(normalizeMessage) : mergeMessages(current, data.messages))
    if (mode === 'replace' || before || reset) setHasOlderMessages(data.hasMore)
    setChatError(null)
    if (!before) setChatUpdating(false)
    return data
  }, [privateCache])

  const beginOlderMessages = (chatId: string) => {
    const operation = { id: chatId, cursor: privateCache.get(chatId)?.cursor }
    olderChatInFlight.current = operation
    latestChatRequest.current += 1
    return operation
  }
  const finishOlderMessages = async (operation: { id: string; cursor?: string }) => {
    try {
      if (operation.cursor && selectedChatId.current === operation.id) {
        await loadMessages(operation.id, 'merge', undefined, operation.cursor)
      }
    } finally {
      if (olderChatInFlight.current === operation) olderChatInFlight.current = null
    }
  }

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => Promise.all([
      accountId && cachePreference.enabled ? privateCache.start() : privateCache.whenReady(),
      accountId && cachePreference.enabled ? groupCache.start() : groupCache.whenReady(),
      load(true),
    ])).catch((failure: unknown) => {
      if (active) {
        if (failure instanceof CompanionApiError && [401, 403].includes(failure.status)) {
          clearCommunityDirectoryCache()
          setLoaded(false)
          setCompanions([])
          setChats([])
          setSharedWords([])
        }
        setError(failure instanceof Error ? failure.message : 'Could not load companions.')
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [accountId, cachePreference.enabled, load, privateCache, groupCache])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void load().catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Could not refresh companions.')
      })
    }
    const timer = window.setInterval(() => {
      refresh()
    }, 20000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

  useEffect(() => {
    if (!selectedChat) return
    const chatId = selectedChat.id
    const sequence = chatOpenSequence.current
    const refresh = (force = false) => {
      if (document.visibilityState !== 'visible') return
      if (!force && latestChatInFlight.current?.id === chatId && latestChatInFlight.current.sequence === sequence) return
      return loadMessages(chatId, 'merge').then(() => {}).catch((failure: unknown) => {
        if (selectedChatId.current !== chatId || chatOpenSequence.current !== sequence) return
        if (failure instanceof CompanionApiError && [401, 403, 404].includes(failure.status)) {
          privateCache.delete(chatId)
          chatOpenSequence.current += 1
          selectedChatId.current = null
          setSelectedChat(null)
          setChatMessages([])
          setSearchFor(null)
          setSearchState(null)
          setError(failure.message)
          return
        }
        setChatUpdating(false)
        setChatError(failure instanceof Error ? failure.message : 'Could not refresh messages.')
      })
    }
    const timer = window.setInterval(() => {
      void refresh()
    }, 5000)
    const onVisibilityChange = () => { void refresh() }
    const stopLive = watchChatChanges(`/api/companions/chats/${chatId}/live`, () => refresh(true))
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      stopLive()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadMessages, selectedChat, privateCache])

  useEffect(() => {
    if (groupDirectory) groupCache.retain(new Set(groupDirectory.groups.filter((group) => group.joined).map((group) => group.id)))
  }, [groupCache, groupDirectory])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== chatCacheClearedKey || !event.newValue || !accountId
        || (!event.newValue.startsWith(`${accountId}:`) && !event.newValue.startsWith('*:'))) return
      privateCache.stop()
      groupCache.stop()
      clearCommunityDirectoryCache()
      privateCache.retain(new Set())
      groupCache.retain(new Set())
      chatOpenSequence.current += 1
      selectedChatId.current = null
      setSelectedChat(null)
      setOpeningChat(null)
      setSelectedGroupId(null)
      setChatMessages([])
      setPersistentCacheEnabled(false)
      setCacheProblem('Saved chats were cleared in another tab. Reopen a chat to refresh it.')
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [accountId, groupCache, privateCache])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const history = sidebarHistory.current
      const next = event.state?.__deutschCompanionView
      const viewToken = typeof next?.token === 'string' ? next.token : null
      if (viewToken !== history.active) {
        const view = (viewToken && history.entries.get(viewToken)) || (history.active ? { view: history.base, depth: 0 } : null)
        if (view) {
          history.active = viewToken && history.entries.has(viewToken) ? viewToken : null
          history.depth = view.depth
          setSidebarView(view.view)
        }
      }
      const token = conversationHistoryEntry.current
      if (!token || isConversationEntry(event.state, token)) return
      conversationHistoryEntry.current = null
      chatOpenSequence.current += 1
      setOpeningChat(null)
      setReportingMessageId(null)
      setSelectedGroupId(null)
      selectedChatId.current = null
      setSelectedChat(null)
      setChatMessages([])
      setActiveWord(null)
      setWordChipsFor(null)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const switchSidebarView = (view: SidebarView) => {
    if (view === sidebarView) return
    const history = sidebarHistory.current
    if (!conversationHistoryEntry.current) {
      if (!history.active) history.base = sidebarView
      const token = crypto.randomUUID()
      history.depth += 1
      history.active = token
      history.entries.set(token, { view, depth: history.depth })
      window.history.pushState({ ...window.history.state, __deutschCompanionView: { token, depth: history.depth } }, '', window.location.href)
    }
    setSidebarView(view)
  }

  const replyingTo = reply && reply.chatId === selectedChat?.id ? reply.message : null
  const fetchPractice = useCallback(async (chatId: string) => {
    const data = await request(`/chats/${chatId}/practice`) as { practice?: PracticeSession | null }
    if (!('practice' in data)) throw new Error('The companion service returned an incomplete practice session.')
    return data.practice ?? null
  }, [])
  const reconcileOutbox = outbox.reconcile
  const pendingMessages = outbox.items.filter((item) => item.kind === 'private'
    && (item.chatId === selectedChat?.id || (item.recipientId && item.recipientId === (selectedChat?.companion.id ?? openingChat?.id)))
    && !chatMessages.some((message) => message.id === item.id))
  const sentPendingKey = pendingMessages.filter((item) => item.status === 'sent').map((item) => item.id).join(',')
  const refreshedSends = useRef(new Set<string>())

  useEffect(() => {
    if (selectedChat) reconcileOutbox('private', selectedChat.id, chatMessages.map((message) => message.id))
  }, [selectedChat, chatMessages, reconcileOutbox])

  useEffect(() => {
    if (!selectedChat) return
    let active = true
    const refresh = () => {
      void fetchPractice(selectedChat.id)
        .then((nextPractice) => { if (active) setPractice(nextPractice) })
        .catch((failure: unknown) => {
          if (active) setChatError(failure instanceof Error ? failure.message : 'Could not update practice together.')
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 4000)
    return () => { active = false; window.clearInterval(timer) }
  }, [selectedChat, fetchPractice])

  useEffect(() => {
    if (!selectedChat || chatLoading || chatUpdating || !sentPendingKey) return
    const ids = sentPendingKey.split(',').filter((id) => !refreshedSends.current.has(id))
    if (!ids.length) return
    ids.forEach((id) => refreshedSends.current.add(id))
    void loadMessages(selectedChat.id, 'merge').catch((failure: unknown) => {
      setChatError(failure instanceof Error ? failure.message : 'Could not refresh sent messages.')
    })
  }, [selectedChat, chatLoading, chatUpdating, sentPendingKey, loadMessages])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      workspace.current?.querySelectorAll<HTMLDetailsElement>('.companion-row-menu[open], .companion-message-menu[open], .companion-sidebar-details[open], .companion-word-picker[open], .companion-practice-fab[open]').forEach((menu) => {
        const owner = target instanceof Element ? target.closest<HTMLElement>('[data-panel-owner]')?.dataset.panelOwner : undefined
        if (owner && [...menu.querySelectorAll('[aria-controls]')].some((element) => element.getAttribute('aria-controls') === owner)) return
        if (!menu.contains(target)) menu.open = false
      })
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  useEffect(() => {
    if (!activeWord || dictionary || dictionaryFailed) return
    let active = true
    loadDictionary().then((loaded) => { if (active) setDictionary(loaded) }).catch(() => { if (active) setDictionaryFailed(true) })
    return () => { active = false }
  }, [activeWord, dictionary, dictionaryFailed])

  useEffect(() => {
    if ((!activeWord && !selectedChat && !selectedGroupId) || starterPack || starterFailed) return
    let active = true
    loadStarterPack().then((pack) => { if (active) setStarterPack(pack) }).catch(() => {
      if (active) {
        setStarterFailed(true)
        onNotify('Could not load the starter vocabulary for word lookup.')
      }
    })
    return () => { active = false }
  }, [activeWord, selectedChat, selectedGroupId, starterPack, starterFailed, onNotify])

  useEffect(() => {
    if (!reactionPickerFor && !activeWord) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setReactionPickerFor(null)
      setActiveWord(null)
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [reactionPickerFor, activeWord])

  useEffect(() => {
    if (!selectedChat) return
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [selectedChat])

  const searchOpen = Boolean(selectedChat) && searchFor === selectedChat?.id
  const searchTerm = searchQuery.trim()
  useEffect(() => {
    if (!searchFor || searchTerm.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      request(`/chats/${searchFor}/search?q=${encodeURIComponent(searchTerm)}`).then((data) => {
        const result = data as { messages: ChatMessage[]; hasMore: boolean }
        if (!Array.isArray(result.messages)) throw new Error('The chat service returned an incomplete response.')
        if (active) setSearchState({ chatId: searchFor, query: searchTerm, messages: result.messages.map(normalizeMessage), hasMore: Boolean(result.hasMore) })
      }).catch((failure: unknown) => {
        if (!active) return
        setSearchState({ chatId: searchFor, query: searchTerm, messages: [], hasMore: false })
        setChatError(failure instanceof Error ? failure.message : 'Could not search this conversation.')
      })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [searchFor, searchTerm])

  const newestMessageId = chatMessages.at(-1)?.id ?? null
  const incomingMessageIds = chatMessages.filter((message) => !message.isMine).map((message) => message.id)
  const incomingIdsKey = incomingMessageIds.join(',')
  const markChatRead = useCallback(async (id: string) => {
    if (!selectedChat) return
    const ids = incomingIdsKey ? incomingIdsKey.split(',') : []
    if (!ids.length) await request(`/chats/${selectedChat.id}/read`, { id, ids: [] })
    for (let offset = 0; offset < ids.length; offset += 50) {
      await request(`/chats/${selectedChat.id}/read`, { id, ids: ids.slice(offset, offset + 50) })
    }
  }, [selectedChat, incomingIdsKey])
  const onChatRead = useCallback(() => {
    if (selectedChat) setChats((current) => current.map((chat) =>
      chat.id === selectedChat.id && chat.lastMessage?.id === newestMessageId ? { ...chat, unread: false } : chat))
  }, [newestMessageId, selectedChat])
  const onChatReadError = useCallback((failure: unknown) => {
    setChatError(failure instanceof Error ? failure.message : 'Could not mark messages as read.')
  }, [])
  const deliverChat = useCallback(async (ids: string[]) => {
    if (selectedChat) await request(`/chats/${selectedChat.id}/delivered`, { id: ids[ids.length - 1], ids })
  }, [selectedChat])
  const onChatDeliveryError = useCallback((failure: unknown) => {
    setChatError(failure instanceof Error ? failure.message : 'Could not acknowledge message delivery.')
  }, [])
  const publishTyping = useChatTyping(
    useCallback(async (id: string, typing: boolean) => { await request(`/chats/${id}/typing`, { typing }) }, []),
    useCallback((failure: unknown) => setChatError(failure instanceof Error ? failure.message : 'Could not update typing status.'), []),
  )
  useEffect(() => {
    const chatId = selectedChat?.id
    if (!chatId || practice?.status !== 'active' || practice.role !== 'learner') return
    return () => publishTyping(chatId, false)
  }, [selectedChat?.id, practice?.id, practice?.role, practice?.status, publishTyping])
  useVisibleChatRead({
    chatKey: selectedChat?.id ?? null,
    messageId: newestMessageId,
    receiptKey: incomingIdsKey,
    enabled: sidebarView === 'chats' && !chatLoading && !chatUpdating,
    stream: chatStream,
    markRead: markChatRead,
    onRead: onChatRead,
    onError: onChatReadError,
  })
  useChatDelivery({
    chatKey: selectedChat?.id ?? null,
    messageIds: incomingMessageIds,
    enabled: sidebarView === 'chats' && !chatLoading && !chatUpdating,
    deliver: deliverChat,
    onError: onChatDeliveryError,
  })
  useEffect(() => {
    const composer = messageComposer.current
    if (!composer) return
    composer.style.height = 'auto'
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`
  }, [messageDraft])

  useEffect(() => {
    const stream = chatStream.current
    if (!stream || chatLoading) return
    if (scrollOnOpen.current) {
      // A freshly opened chat starts at the newest message, without animating through the history.
      scrollOnOpen.current = false
      lastScrolledMessage.current = newestMessageId
      stream.scrollTop = stream.scrollHeight
      window.requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight })
      return
    }
    if (!newestMessageId) {
      lastScrolledMessage.current = null
      return
    }
    if (newestMessageId !== lastScrolledMessage.current) {
      if (!awayFromBottom || chatMessages.at(-1)?.isMine) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        stream.scrollTo({ top: stream.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
      }
      lastScrolledMessage.current = newestMessageId
    }
  }, [newestMessageId, chatLoading, awayFromBottom, chatMessages])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setChatError(null)
    try {
      await operation()
    } catch (failure) {
      const description = failure instanceof Error ? failure.message : 'Could not complete the request.'
      setError(description)
      if (selectedChatId.current) setChatError(description)
    } finally {
      setBusy(false)
    }
  }

  const togglePersistentCache = async () => {
    if (!accountId) return
    const enabled = !persistentCacheEnabled
    setBusy(true)
    setCacheProblem(null)
    try {
      setChatCacheEnabled(enabled)
      setPersistentCacheEnabled(enabled)
      if (enabled) {
        await Promise.all([privateCache.start(), groupCache.start()])
      } else {
        privateCache.stop()
        groupCache.stop()
        await clearChatCache(accountId)
      }
    } catch (failure) {
      setCacheProblem(failure instanceof Error ? `Could not update saved chats: ${failure.message}` : 'Could not update saved chats on this device.')
    } finally {
      setBusy(false)
    }
  }

  const closePopover = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  const search = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username.trim()) return
    if (!validate(event.currentTarget)) return
    setFound(null)
    void run(async () => {
      const data = await request('/search', { username }) as { user?: Profile }
      if (!data.user) throw new Error('The companion service returned an incomplete response.')
      setFound(data.user)
    })
  }

  const action = (user: Profile, choice: Action | 'request') => {
    void run(async () => {
      await request(choice === 'request' ? '/request' : '/action',
        choice === 'request' ? { id: user.id } : { id: user.id, action: choice })
      if ((choice === 'block' || choice === 'remove') && selectedChat?.companion.id === user.id) {
        selectedChatId.current = null
        setSelectedChat(null)
        setChatMessages([])
      }
      setFound(null)
      onNotify(choice === 'request' ? 'Request sent. It will appear in their companion panel.' : 'Companions updated.')
      await load()
    })
  }

  const confirmedAction = async (user: Profile, choice: Action) => {
    const name = user.username
    const copy: Record<Exclude<Action, 'accept'>, { title: string; message: string; confirmLabel: string; cancelLabel?: string; tone?: 'danger' | 'neutral' }> = {
      block: { title: `Block ${name}?`, message: 'This ends any connection and stops requests and chat in both directions. Unblocking does not restore the connection.', confirmLabel: 'Block', tone: 'danger' },
      remove: { title: `Remove ${name}?`, message: 'They will no longer be a companion and your private chat ends. Either of you can send a new request after 24 hours.', confirmLabel: 'Remove companion', tone: 'danger' },
      unblock: { title: `Unblock ${name}?`, message: 'You are not reconnected automatically. Either of you can send a new request after 24 hours.', confirmLabel: 'Unblock' },
      decline: { title: `Decline ${name}’s request?`, message: 'They cannot send another request for 24 hours.', confirmLabel: 'Decline', tone: 'danger' },
      cancel: { title: 'Cancel your request?', message: `Your request to ${name} is withdrawn. You can send another after 24 hours.`, confirmLabel: 'Cancel request', cancelLabel: 'Keep request' },
    }
    if (choice !== 'accept' && !await confirmDialog(copy[choice])) return
    action(user, choice)
  }

  const requestDeleteChat = async () => {
    if (!selectedChat) return
    const name = selectedChat.companion.username
    const confirmed = await confirmDialog({
      title: 'Delete this conversation?',
      message: `It is cleared from your list and your view. ${name} keeps their copy, and a new message can bring the conversation back.`,
      confirmLabel: 'Delete conversation',
      tone: 'danger',
    })
    if (confirmed) deleteChat()
  }

  const requestUnsend = async (chatMessage: ChatMessage) => {
    const confirmed = await confirmDialog({
      title: 'Unsend this message?',
      message: 'It is removed for both of you and replaced by “Message unsent”. A copy already included in a report is kept for moderation.',
      confirmLabel: 'Unsend',
      tone: 'danger',
    })
    if (confirmed) unsendMessage(chatMessage)
  }

  const requestNudge = async (user: Companion) => {
    const confirmed = await confirmDialog({
      title: `Send ${user.username} a reminder?`,
      message: 'A gentle, one-time nudge appears in their companion panel and may be emailed if they have notifications on. You can send one reminder a day.',
      confirmLabel: 'Send reminder',
    })
    if (confirmed) sendNudge(user)
  }

  const requestShareWord = async (recipient: Profile, card: Card) => {
    const confirmed = await confirmDialog({
      title: `Share ${card.prompt} with ${recipient.username}?`,
      message: 'They see a preview and choose whether to add it to their deck. Shares expire after 30 days.',
      confirmLabel: 'Share word',
    })
    if (confirmed) sendWord(recipient)
  }

  const requestWordCard = async (card: Card) => {
    const name = selectedChat?.companion.username ?? 'your companion'
    const confirmed = await confirmDialog({
      title: `Send ${card.prompt} to ${name}?`,
      message: 'It appears in the chat as a word card they can add to their deck.',
      confirmLabel: 'Send word',
    })
    if (confirmed) sendWordCard(card)
  }

  const requestDismissShare = async (share: SharedWordPreview) => {
    const confirmed = await confirmDialog({
      title: `Set aside ${share.card.prompt}?`,
      message: 'It is removed from your shared words. You can ask your companion to share it again.',
      confirmLabel: 'Set aside',
    })
    if (confirmed) resolveShare(share, 'dismiss')
  }

  const openChat = (user: Profile) => {
    const existing = chats.find((chat) => chat.companion.id === user.id)
    if (existing && selectedChatId.current === existing.id) return
    const sequence = ++chatOpenSequence.current
    const cached = existing ? privateCache.get(existing.id) : null
    setSidebarView('chats')
    if (!conversationHistoryEntry.current) {
      const token = `${Date.now()}-${Math.random()}`
      window.history.pushState(conversationEntryState(window.history.state, 'private', token), '', window.location.href)
      conversationHistoryEntry.current = token
    }
    setSelectedGroupId(null)
    setPractice(null)
    setReportingMessageId(null)
    setMessageMenu(null)
    chatDetailsMenu.current = null
    setChatDetailsMenuOpen(false)
    setActiveWord(null)
    setWordChipsFor(null)
    selectedChatId.current = existing?.id ?? null
    lastScrolledMessage.current = null
    scrollOnOpen.current = true
    setAwayFromBottom(false)
    setSelectedChat(existing ? { id: existing.id, companion: user } : null)
    setOpeningChat(existing ? null : user)
    setChatMessages(cached?.messages ?? [])
    setHasOlderMessages(cached?.hasMore ?? false)
    setChatLoading(!cached)
    setChatUpdating(Boolean(cached))
    setChatError(null)
    setError(null)
    void (async () => {
      try {
        const data = existing ? { id: existing.id, companion: user } : await request('/chats/open', { id: user.id }) as { id: string; companion: Profile }
        if (typeof data.id !== 'string' || !data.companion) throw new Error('The chat service returned an incomplete response.')
        if (chatOpenSequence.current !== sequence) return
        selectedChatId.current = data.id
        setSelectedChat({ id: data.id, companion: data.companion })
        setOpeningChat(null)
        await loadMessages(data.id)
      } catch (failure) {
        if (chatOpenSequence.current === sequence) {
          privateCache.delete(existing?.id ?? '')
          if (cached) setChatMessages([])
          setChatUpdating(false)
          const description = failure instanceof Error ? failure.message : 'Could not open this conversation.'
          if (failure instanceof CompanionApiError && [401, 403, 404].includes(failure.status)) {
            chatOpenSequence.current += 1
            selectedChatId.current = null
            setSelectedChat(null)
            setSearchFor(null)
            setSearchState(null)
          }
          setChatError(description)
          setError(description)
          setOpeningChat(null)
        }
      } finally {
        if (chatOpenSequence.current === sequence) setChatLoading(false)
      }
    })()
  }

  const closeChat = () => {
    chatOpenSequence.current += 1
    setOpeningChat(null)
    setReportingMessageId(null)
    setMessageMenu(null)
    chatDetailsMenu.current = null
    setChatDetailsMenuOpen(false)
    if (conversationHistoryEntry.current) {
      const state = window.history.state
      const overlay = isChatOverlayEntry(state, conversationHistoryEntry.current)
      conversationHistoryEntry.current = null
      if (overlay) window.history.replaceState(withoutChatOverlay(state), '', window.location.href)
      leaveChatHistory(overlay ? 2 : 1)
    }
    setSelectedGroupId(null)
    selectedChatId.current = null
    setSelectedChat(null)
    setChatMessages([])
    setActiveWord(null)
    setWordChipsFor(null)
  }

  const openGroup = (id: string) => {
    chatOpenSequence.current += 1
    setOpeningChat(null)
    setReportingMessageId(null)
    setMessageMenu(null)
    chatDetailsMenu.current = null
    setChatDetailsMenuOpen(false)
    setSidebarView('groups')
    if (!conversationHistoryEntry.current) {
      const token = `${Date.now()}-${Math.random()}`
      window.history.pushState(conversationEntryState(window.history.state, 'group', token), '', window.location.href)
      conversationHistoryEntry.current = token
    }
    selectedChatId.current = null
    setSelectedChat(null)
    setChatMessages([])
    setActiveWord(null)
    setWordChipsFor(null)
    setSelectedGroupId(id)
  }

  const closeGroup = () => {
    if (conversationHistoryEntry.current) {
      const state = window.history.state
      const overlay = isChatOverlayEntry(state, conversationHistoryEntry.current)
      conversationHistoryEntry.current = null
      if (overlay) window.history.replaceState(withoutChatOverlay(state), '', window.location.href)
      leaveChatHistory(overlay ? 2 : 1)
    }
    setSelectedGroupId(null)
    setActiveWord(null)
    setWordChipsFor(null)
  }

  const backToDeck = () => {
    const conversationEntry = Boolean(conversationHistoryEntry.current)
    conversationHistoryEntry.current = null
    closeChat()
    onBack(conversationEntry, sidebarHistory.current.depth)
  }

  const startReply = (chatMessage: ChatMessage) => {
    if (!selectedChat) return
    setReply({ chatId: selectedChat.id, message: chatMessage })
    setReactionPickerFor(null)
    messageComposer.current?.focus()
  }

  const jumpToMessage = (id: string) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(`companion-message-${id}`)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
  }

  const replaceMessage = (message: ChatMessage) => {
    const next = normalizeMessage(message)
    setChatMessages((current) => current.map((item) => item.id === next.id ? next : item))
  }

  const startCorrection = (chatMessage: ChatMessage) => {
    setCorrecting({ messageId: chatMessage.id, text: chatMessage.text, note: '', tags: [] })
    setReactionPickerFor(null)
  }

  const submitCorrection = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!correcting || !correcting.text.trim()) return
    const { messageId, text, note, tags } = correcting
    void run(async () => {
      const data = await request(`/messages/${messageId}/correction`, { text, ...(note.trim() ? { note } : {}), ...(tags.length ? { tags } : {}) }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      replaceMessage(data.message)
      setCorrecting(null)
      onNotify('Correction suggested.')
    })
  }

  const approveMessage = (chatMessage: ChatMessage) => {
    void run(async () => {
      const data = await request(`/messages/${chatMessage.id}/correction`, { approve: true }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      replaceMessage(data.message)
      onNotify('Marked as looking good.')
    })
  }

  const respondToCorrection = async (chatMessage: ChatMessage, response: 'thanks' | 'saved') => {
    const data = await request(`/messages/${chatMessage.id}/correction/respond`, { response }) as { message: ChatMessage }
    if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
    replaceMessage(data.message)
  }

  const saveCorrection = (chatMessage: ChatMessage, meaning: string) => {
    if (!selectedChat || !chatMessage.correction?.text || !meaning.trim()) return
    const { correction } = chatMessage
    const sentence = correction.text as string
    const result = onReceiveWord({
      id: `correction-${chatMessage.id}`,
      card: { prompt: sentence, meaning: meaning.trim(), example: sentence, translation: meaning.trim(), category: 'phrase' },
      note: correction.note ?? '',
      sender: selectedChat.companion,
      createdAt: correction.createdAt,
    })
    if (!result) return
    if (result === 'already-present') onNotify('That sentence is already in your deck.')
    void run(async () => {
      await respondToCorrection(chatMessage, 'saved')
      setSavingCorrection(null)
    })
  }

  const toggleSearch = () => {
    if (!selectedChat) return
    if (searchOpen) {
      setSearchFor(null)
      return
    }
    if (searchState?.chatId !== selectedChat.id) setSearchQuery('')
    setSearchFor(selectedChat.id)
  }

  const showSearchResult = async (result: ChatMessage) => {
    if (!selectedChat) return
    const chatId = selectedChat.id
    let found = chatMessages.some((item) => item.id === result.id)
    let before = chatMessages[0]
    const operation = beginOlderMessages(chatId)
    setLoadingOlder(true)
    let problem: unknown = null
    try {
      for (let page = 0; !found && before && page < 20; page += 1) {
        const loaded = await loadMessages(chatId, 'merge', before)
        if (!loaded?.messages.length) break
        found = loaded.messages.some((item) => item.id === result.id)
        before = loaded.messages[0]
        if (!loaded.hasMore) break
      }
    } catch (failure) {
      problem = failure
    } finally {
      try { await finishOlderMessages(operation) } catch (failure) {
        problem ??= failure
      }
      if (problem) setChatError(problem instanceof Error ? problem.message : 'Could not load earlier messages.')
      setLoadingOlder(false)
    }
    if (problem) return
    if (!found) {
      setChatError('That message is too far back to show here.')
      return
    }
    setSearchFor(null)
    setHighlightId(result.id)
    window.setTimeout(() => jumpToMessage(result.id), 60)
    window.setTimeout(() => setHighlightId((current) => current === result.id ? null : current), 2600)
  }

  const canModify = (chatMessage: ChatMessage) =>
    chatMessage.isMine && chatMessage.kind !== 'unsent' && Boolean(chatMessage.editableUntil) && Date.parse(chatMessage.editableUntil!) > now

  const submitEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || !editing.text.trim()) return
    const { messageId, text } = editing
    void run(async () => {
      const data = await request(`/messages/${messageId}/edit`, { text }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      replaceMessage(data.message)
      setEditing(null)
    })
  }

  const unsendMessage = (chatMessage: ChatMessage) => {
    const chatId = selectedChat?.id
    if (!chatId) return
    void run(async () => {
      const data = await request(`/messages/${chatMessage.id}/unsend`, {}) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      replaceMessage(data.message)
      setEditing(null)
      await loadMessages(chatId, 'merge')
      await load()
    })
  }

  const toggleReaction = async (chatMessage: ChatMessage, emoji: string) => {
    const mine = chatMessage.reactions.find((reaction) => reaction.mine)?.emoji
    setReactionPickerFor(null)
    try {
      const data = await request(`/messages/${chatMessage.id}/reaction`, { emoji: mine === emoji ? null : emoji }) as { reactions: Reaction[] }
      if (!Array.isArray(data.reactions)) throw new Error('The chat service returned an incomplete response.')
      setChatMessages((current) => current.map((item) => item.id === chatMessage.id ? { ...item, reactions: data.reactions } : item))
      setChatError(null)
    } catch (failure) {
      setChatError(failure instanceof Error ? failure.message : 'Could not update your reaction.')
    }
  }

  const sendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if ((!selectedChat && !openingChat) || !messageDraft.trim()) return
    const text = messageDraft.trim()
    const chatId = selectedChat?.id ?? `opening:${openingChat!.id}`
    try {
      outbox.enqueue({ kind: 'private', chatId, text, ...(!selectedChat && openingChat ? { recipientId: openingChat.id } : {}), ...(replyingTo ? {
        replyTo: { id: replyingTo.id, isMine: replyingTo.isMine, text: replyingTo.text },
      } : {}) })
      setMessageDraft('')
      if (selectedChat) publishTyping(chatId, false)
      setReply(null)
      setChatError(null)
      requestAnimationFrame(() => { if (chatStream.current) chatStream.current.scrollTop = chatStream.current.scrollHeight })
    } catch (failure) {
      setChatError(failure instanceof Error ? failure.message : 'Could not send this message.')
    }
  }

  const loadOlderMessages = () => {
    if (!selectedChat || !chatMessages.length) return
    const chatId = selectedChat.id
    const operation = beginOlderMessages(chatId)
    setLoadingOlder(true)
    void (async () => {
      try { await loadMessages(chatId, 'merge', chatMessages[0]) }
      finally { await finishOlderMessages(operation) }
    })().catch((failure: unknown) => {
      setChatError(failure instanceof Error ? failure.message : 'Could not load earlier messages.')
    }).finally(() => setLoadingOlder(false))
  }

  const deleteChat = () => {
    if (!selectedChat) return
    const chatId = selectedChat.id
    void run(async () => {
      await request(`/chats/${chatId}/delete`, {})
      privateCache.delete(chatId)
      closeChat()
      onNotify('Conversation deleted.')
      await load()
    })
  }

  const reportMessage = async (messageId: string, reason: ReportReason, details: string) => {
    await request(`/messages/${messageId}/report`, { reason, ...(details ? { details } : {}) })
    setChatMessages((current) => current.map((item) => item.id === messageId ? { ...item, reported: true } : item))
    onNotify('Thanks. Your report was recorded.')
  }

  const markNudgeRead = (user: Companion) => {
    void run(async () => {
      await request('/nudge/read', { id: user.id })
      await load()
    })
  }

  const sendNudge = (user: Companion) => {
    void run(async () => {
      await request('/nudge', { id: user.id })
      await load()
      onNotify(`A gentle reminder was sent to ${user.username}.`)
    })
  }

  const sendWordCard = (card: Card) => {
    if (!selectedChat) return
    const chatId = selectedChat.id
    const replyToId = replyingTo?.id
    void run(async () => {
      const data = await request(`/chats/${chatId}/messages`, {
        card: sharedCardPayload(card),
        ...(replyToId ? { replyToId } : {}),
      }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      setChatMessages((current) => mergeMessages(current, [data.message]))
      setReply(null)
      setWordPickerQuery('')
      if (wordPicker.current) wordPicker.current.open = false
      await load()
    })
  }

  const addChatWord = (chatMessage: ChatMessage) => {
    if (!selectedChat || !chatMessage.card) return
    const result = onReceiveWord({
      id: chatMessage.id,
      card: chatMessage.card,
      note: '',
      sender: selectedChat.companion,
      createdAt: chatMessage.createdAt,
    })
    if (result === 'already-present') onNotify(`You already had ${chatMessage.card.prompt} in your deck.`)
  }

  const sendWord = (recipient: Profile) => {
    const card = cards.find((item) => item.id === selectedCardId && item.status === 'active' && isShareableCard(item))
    if (!card) return
    void run(async () => {
      await request('/share', {
        recipientId: recipient.id,
        card: sharedCardPayload(card),
        ...(shareNote.trim() ? { note: shareNote.trim() } : {}),
      })
      setSelectedCardId('')
      setShareNote('')
      setShareQuery('')
      if (shareTools.current) shareTools.current.open = false
      onNotify(`Word shared with ${recipient.username}.`)
    })
  }

  const resolveShare = (share: SharedWordPreview, choice: 'add' | 'dismiss') => {
    void run(async () => {
      const receiveResult = choice === 'add' ? onReceiveWord(share) : false
      if (choice === 'add' && !receiveResult) return
      await request(`/shares/${share.id}/${choice === 'add' ? 'add' : 'dismiss'}`, {})
      setSharedWords((current) => current.filter((item) => item.id !== share.id))
      onNotify(choice === 'add'
        ? receiveResult === 'added'
          ? `${share.card.prompt} was added to your deck, shared by ${share.sender.username}.`
          : `You already had ${share.card.prompt} in your deck.`
        : 'Word set aside.')
    })
  }

  const startPractice = async () => {
    if (!selectedChat) return
    const scope = practiceTag ? ` from ${practiceTag}` : ''
    const confirmed = await confirmDialog({
      title: `Ask ${selectedChat.companion.username} to practise together?`,
      message: `Ask for help reviewing five randomly chosen words${scope}? Your review schedule will not change.`,
      confirmLabel: 'Ask to practise',
    })
    if (!confirmed) return
    void run(async () => {
      const data = await request(`/chats/${selectedChat.id}/practice`, practiceTag ? { tag: practiceTag } : {}) as { practice?: PracticeSession }
      if (!data.practice) throw new Error('The companion service did not start a practice session.')
      setPractice(data.practice)
      if (practicePicker.current) practicePicker.current.open = false
      onNotify(`Practice request sent to ${selectedChat.companion.username}.`)
    })
  }

  const decidePractice = (decision: PracticeDecision) => {
    if (!selectedChat || !practice) return
    void run(async () => {
      const data = await request(`/chats/${selectedChat.id}/practice/${practice.id}/decision`, { decision }) as { practice?: PracticeSession }
      if (!data.practice) throw new Error('The companion service did not update the practice session.')
      const finished = data.practice.status === 'ended' || data.practice.status === 'completed' || data.practice.status === 'declined'
      setPractice(finished ? null : data.practice)
      if (decision === 'decline') onNotify('Practice request declined.')
      else if (data.practice.status === 'completed') onNotify('Practice complete. Nice work.')
      else if (data.practice.status === 'ended') onNotify('Practice ended.')
    })
  }

  const submitPracticeAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedChat || !practice || !practiceAnswer.trim()) return
    publishTyping(selectedChat.id, false)
    void run(async () => {
      const data = await request(`/chats/${selectedChat.id}/practice/${practice.id}/answer`, { answer: practiceAnswer }) as { practice?: PracticeSession }
      if (!data.practice) throw new Error('The companion service did not save your answer.')
      setPractice(data.practice)
      setPracticeAnswer('')
    })
  }

  const matchingCards = useMemo(() => {
    const query = shareQuery.trim().toLocaleLowerCase()
    const matching: Card[] = []
    for (const card of cards) {
      if (card.status !== 'active' || !isShareableCard(card)
        || (query && !`${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(query))) continue
      matching.push(card)
      if (matching.length === 6) break
    }
    return matching
  }, [cards, shareQuery])
  const pickerQuery = wordPickerQuery.trim().toLocaleLowerCase()
  const hasConversation = Boolean(selectedChat || selectedGroupId)
  const pickerCards = useMemo(() => !hasConversation ? [] : cards
    .filter((card) => card.status === 'active' && isShareableCard(card)
      && (!pickerQuery || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(pickerQuery)))
    .sort((a, b) => Date.parse(b.lastReviewedAt ?? b.createdAt) - Date.parse(a.lastReviewedAt ?? a.createdAt))
    .slice(0, 8), [cards, hasConversation, pickerQuery])
  const practiceTags = useMemo(() => [...new Set(cards
    .filter((card) => card.status === 'active' && card.reviewHistory.length > 0)
    .flatMap((card) => card.tags))].sort((a, b) => a.localeCompare(b)), [cards])
  const deckWordKeys = useMemo(() => new Set(hasConversation ? cards.map(cardContentKey) : []), [cards, hasConversation])
  const repliedToIds = new Set(chatMessages.flatMap((item) => item.replyTo ? [item.replyTo.id] : []))
  const deckEntries = useMemo(() => !hasConversation ? [] : cards
    .filter((card) => card.status === 'active')
    .map((card) => ({ id: card.id, source: 'deck' as const, prompt: card.prompt, meaning: card.meaning, category: card.category, plural: card.plural })), [cards, hasConversation])
  const deckWordIndex = useMemo(() => indexWords(deckEntries), [deckEntries])
  const deckMeaningIndex = useMemo(() => indexMeanings(deckEntries), [deckEntries])
  const starterEntries = useMemo(() => (starterPack?.cards ?? []).map((entry) => ({
    id: entry.id,
    source: 'starter' as const,
    prompt: entry.article ? `${entry.article} ${entry.word}` : entry.word,
    meaning: entry.meaning,
    category: entry.category,
    plural: entry.plural,
    example: entry.example,
    translation: entry.translation,
    level: entry.level,
  })), [starterPack])
  const starterWordIndex = useMemo(() => indexWords(starterEntries), [starterEntries])
  const starterMeaningIndex = useMemo(() => indexMeanings(starterEntries), [starterEntries])
  const germanEntries = activeWord
    ? distinctEntries([
      findWord(activeWord.key, deckWordIndex, starterWordIndex),
      ...(dictionary ? lookupDictionary(dictionary, activeWord.word) : []),
    ].filter((entry): entry is WordEntry => Boolean(entry)), 3)
    : []
  const englishEntries = activeWord
    ? distinctEntries([
      ...findMeaning(activeWord.word, deckMeaningIndex, starterMeaningIndex),
      ...(dictionary ? lookupEnglish(dictionary, activeWord.word) : []),
    ], 5)
    : []
  const isEntryInDeck = (entry: WordEntry) => entry.source === 'deck'
    || deckWordIndex.has(normalizeWord(entry.prompt.replace(/^(der|die|das)\s+/i, '')))

  const pickWord = (messageId: string, word: string) => {
    const key = normalizeWord(word)
    setActiveWord((current) => current?.messageId === messageId && current.key === key ? null : { messageId, key, word })
  }

  const addPeekedWord = (entry: WordEntry) => {
    const starter = entry.source === 'starter' ? starterPack?.cards.find((item) => item.id === entry.id) : undefined
    const result = entry.source === 'dictionary' ? onAddDictionaryWord(entry) : starter ? onAddStarterWord(starter) : false
    if (result === 'already-present') onNotify(`You already had ${entry.prompt} in your deck.`)
  }
  const wordTools: MessageWordTools = {
    activeWord,
    wordChipsFor,
    pickWord,
    isKnown: (word) => Boolean(findWord(word, deckWordIndex, starterWordIndex)),
    german: germanEntries,
    english: englishEntries,
    loading: (!dictionary && !dictionaryFailed) || (!starterPack && !starterFailed),
    unavailable: dictionaryFailed || starterFailed,
    inDeck: isEntryInDeck,
    onAdd: addPeekedWord,
    onClose: () => setActiveWord(null),
    toggleChips: (id) => setWordChipsFor((current) => current === id ? null : id),
  }

  const toggleCorrectionTag = (tag: string) => {
    setCorrecting((current) => {
      if (!current) return current
      if (current.tags.includes(tag)) return { ...current, tags: current.tags.filter((item) => item !== tag) }
      return current.tags.length >= 3 ? current : { ...current, tags: [...current.tags, tag] }
    })
  }
  const incomingRequests = companions.filter((user) => user.status === 'incoming')
    .sort((a, b) => a.username.localeCompare(b.username))
  const outgoingRequests = companions.filter((user) => user.status === 'outgoing')
    .sort((a, b) => a.username.localeCompare(b.username))
  const requestCount = incomingRequests.length + outgoingRequests.length
  const unreadCount = chats.filter((chat) => chat.unread).length
  const selectedGroup = groupDirectory?.groups.find((group) => group.id === selectedGroupId && group.joined) ?? null
  const joinedGroupCount = groupDirectory?.groups.filter((group) => group.joined).length ?? 0
  const unreadGroupCount = groupDirectory?.groups.filter((group) => group.joined && Boolean(group.unreadCount)).length ?? 0
  const blockedCompanions = companions.filter((user) => user.status === 'blocked')
  const connectedCompanions = companions.filter((user) => user.status === 'connected')
    .sort((a, b) => {
      const aTime = chats.find((chat) => chat.companion.id === a.id)?.lastMessage?.createdAt ?? ''
      const bTime = chats.find((chat) => chat.companion.id === b.id)?.lastMessage?.createdAt ?? ''
      return bTime.localeCompare(aTime) || a.username.localeCompare(b.username)
    })
  const requestCard = (user: Companion) => <article className="companion-person-card companion-request-card" key={user.id}>
    <div className="companion-person">
      <img src={avatarDataUri(user.avatarSeed)} alt="" />
      <div><strong>{user.username}</strong><span>{user.status === 'incoming' ? 'Wants to connect' : 'Waiting for a reply'}</span></div>
    </div>
    <span className={`companion-status-tag ${user.status}`}>{user.status === 'incoming' ? 'Incoming' : 'Sent'}</span>
    <details className="companion-row-menu">
      <summary aria-label={`Actions for ${user.username}`}><Ellipsis size={17} aria-hidden="true" /></summary>
      <div className="companion-row-popover">
        {user.status === 'incoming'
          ? <><button type="button" disabled={busy} onClick={(event) => { closePopover(event); action(user, 'accept') }}>Accept request</button><button type="button" disabled={busy} onClick={(event) => { closePopover(event); void confirmedAction(user, 'decline') }}>Decline request</button></>
          : <button type="button" disabled={busy} onClick={(event) => { closePopover(event); void confirmedAction(user, 'cancel') }}>Cancel request</button>}
        <button className="danger" type="button" disabled={busy} onClick={(event) => { closePopover(event); void confirmedAction(user, 'block') }}>Block learner</button>
      </div>
    </details>
  </article>

  const chatActive = Boolean(((selectedChat || openingChat) && sidebarView === 'chats') || (selectedGroup && sidebarView === 'groups'))

  return (
    <div className={`companion-workspace-view${chatActive ? ' chat-active' : ''}`} ref={workspace} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !(event.target instanceof Element)) return
      const menu = event.target.closest<HTMLDetailsElement>('.companion-row-menu[open], .companion-message-menu[open], .companion-sidebar-details[open], .companion-word-picker[open]')
      if (!menu) return
      event.preventDefault()
      event.stopPropagation()
      menu.open = false
      menu.querySelector<HTMLElement>('summary')?.focus()
    }}>
      <div className={`companion-workspace${chatActive ? ' chat-active' : ''}`}>
        <aside className="companion-sidebar" aria-label="Learning companions">
          <div className="companion-sidebar-heading">
            <h1>Companions</h1>
            {loaded && <span className="companion-sidebar-count">{connectedCompanions.length}</span>}
            <button className="companion-mobile-deck-back" type="button" onClick={backToDeck} aria-label="Back to deck" title="Back to deck">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
          </div>
          {error && <p className="companion-alert" role="alert">{error}</p>}
          {cacheProblem && <p className="companion-alert" role="alert">{cacheProblem}</p>}
          {!loading && !loaded ? (
            <button className="companion-primary-button" disabled={busy} onClick={() => void run(load)} type="button">Try again</button>
          ) : <>
            <form className="companion-search" noValidate onInput={handleInput} onSubmit={search}>
              <label className="companion-visually-hidden" htmlFor="companion-search">Find a learner by exact username</label>
              <input id="companion-search" name="username" value={username} onChange={(event) => { setUsername(event.target.value); setFound(null) }} aria-invalid={Boolean(errors.username) || undefined} aria-describedby={errors.username ? 'companion-username-error' : undefined} placeholder="Find learner…" minLength={3} maxLength={20} pattern="[A-Za-z0-9_\\-]+" required />
              <button className="companion-search-submit" disabled={busy} type="submit">Find</button>
              {errors.username && <span className="field-error" id="companion-username-error">{errors.username}</span>}
            </form>

            {found && <section className="companion-result-card">
              <div className="companion-person">
                <img src={avatarDataUri(found.avatarSeed)} alt="" />
                <div><strong>{found.username}</strong><span>Deutsch Deck learner</span></div>
              </div>
              {companions.some((user) => user.id === found.id)
                ? <p className="companion-card-note">This learner is already in your companion list.</p>
                : <div className="companion-card-actions">
                  <button type="button" disabled={busy} onClick={() => action(found, 'request')}>Send request</button>
                  <button type="button" disabled={busy} onClick={() => void confirmedAction(found, 'block')}>Block</button>
                </div>}
            </section>}

            <nav className="companion-sidebar-nav" aria-label="Companion views">
              <button className={sidebarView === 'chats' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'chats'} onClick={() => switchSidebarView('chats')}>
                <LayoutGridCircles size={15} aria-hidden="true" /><span className="companion-nav-label">Chats</span>{loaded && <span className="companion-nav-count">{connectedCompanions.length}</span>}{unreadCount > 0 && <b aria-label={`${unreadCount} unread chats`}>{unreadCount}</b>}
              </button>
              <button className={sidebarView === 'requests' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'requests'} onClick={() => switchSidebarView('requests')}>
                <Inbox size={15} aria-hidden="true" /><span className="companion-nav-label">Requests</span>{loaded && <span className="companion-nav-count">{requestCount}</span>}
              </button>
              <button className={sidebarView === 'shared' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'shared'} onClick={() => switchSidebarView('shared')}>
                <BookOpen size={15} aria-hidden="true" /><span className="companion-nav-label">Shared words</span>{loaded && <span className="companion-nav-count">{sharedWords.length}</span>}
              </button>
              <button className={sidebarView === 'groups' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'groups'} onClick={() => switchSidebarView('groups')}>
                <Users size={15} aria-hidden="true" /><span className="companion-nav-label">Groups</span>{groupDirectory && <span className="companion-nav-count">{joinedGroupCount}</span>}{unreadGroupCount > 0 && <b aria-label={`${unreadGroupCount} groups with unread messages`}>{unreadGroupCount}</b>}
              </button>
              {groupDirectory?.canModerate && <button className={sidebarView === 'moderation' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'moderation'} onClick={() => switchSidebarView('moderation')}>
                <ShieldCheck size={15} aria-hidden="true" /><span className="companion-nav-label">Moderation</span>
              </button>}
            </nav>

            {loading ? <CompanionLoader label="Loading your connections" compact /> : <>
            {sidebarView === 'requests' && <section className="companion-list-section" aria-labelledby="requests-heading">
              <h2 id="requests-heading">Requests <span>{requestCount}</span></h2>
              {requestCount === 0
                ? <p className="companion-empty-note">No pending requests.</p>
                : <>
                  {incomingRequests.length > 0 && <div className="companion-request-group"><h3>For you</h3>{incomingRequests.map(requestCard)}</div>}
                  {outgoingRequests.length > 0 && <div className="companion-request-group"><h3>Sent requests</h3>{outgoingRequests.map(requestCard)}</div>}
                </>}
            </section>}

            {sidebarView === 'chats' && <section className="companion-list-section" aria-labelledby="companions-heading">
              <h2 id="companions-heading">Your companions <span>{connectedCompanions.length}</span></h2>
              {connectedCompanions.length === 0
                ? <p className="companion-empty-note">Accepted connections will appear here.</p>
                : <div className="companion-contact-list">{connectedCompanions.map((user) => {
                  const chat = chats.find((item) => item.companion.id === user.id)
                  const isSelected = selectedChat?.id === chat?.id
                  return <article className={`companion-contact-card${isSelected ? ' selected' : ''}`} key={user.id}>
                    <button className="companion-contact-open" type="button" disabled={busy} onClick={() => openChat(user)} aria-current={isSelected ? 'true' : undefined}>
                      <span className="companion-person">
                        <img src={avatarDataUri(user.avatarSeed)} alt="" />
                        <span className="companion-contact-copy"><strong>{user.username}</strong><span>{chat?.lastMessage ? `${chat.lastMessage.isMine ? 'You: ' : ''}${chat.lastMessage.text}` : 'Start a conversation'}</span></span>
                      </span>
                      <span className="companion-contact-signals">
                        <span className="companion-status-tag connected">Connected</span>
                        {chat?.unread && <span className="companion-unread-dot" aria-label="Unread messages" />}
                      </span>
                    </button>
                    <details className="companion-row-menu">
                      <summary aria-label={`Actions for ${user.username}`}><Ellipsis size={17} aria-hidden="true" /></summary>
                      <div className="companion-row-popover">
                        {user.canNudge
                          ? <button type="button" disabled={busy} onClick={(event) => { closePopover(event); void requestNudge(user) }}>Send a nudge</button>
                          : <span>Nudged recently</span>}
                        {user.nudgeAt && <button type="button" disabled={busy} onClick={(event) => { closePopover(event); markNudgeRead(user) }}>Mark nudge as read</button>}
                        <button className="danger" type="button" disabled={busy} onClick={(event) => { closePopover(event); void confirmedAction(user, 'remove') }}>Remove companion</button>
                      </div>
                    </details>
                  </article>
                })}</div>}
            </section>}

            {sidebarView === 'groups' && <GroupsSidebar directory={groupDirectory} error={groupsError} selectedId={selectedGroup?.id ?? null} onOpen={openGroup} reload={reloadGroups} invitationToken={invitationToken} onInvitationHandled={onInvitationHandled} onNotify={onNotify} />}

            {sidebarView === 'moderation' && groupDirectory?.canModerate && <ModerationQueue onNotify={onNotify} />}

            {sidebarView === 'shared' && <section className="companion-list-section" aria-labelledby="shared-heading">
              <h2 id="shared-heading">Words shared with you <span>{sharedWords.length}</span></h2>
              {sharedWords.length === 0
                ? <p className="companion-empty-note">Shared words from your companions will appear here.</p>
                : sharedWords.map((share) => <article className="companion-shared-card" key={share.id}>
                  <div className="companion-person"><img src={avatarDataUri(share.sender.avatarSeed)} alt="" /><div><strong>{share.sender.username}</strong><span>Shared a word</span></div></div>
                  <p className="shared-word-prompt" lang="de">{share.card.prompt}</p>
                  <p className="companion-word-meaning">{share.card.meaning}</p>
                  {share.note && <p className="shared-word-note">{share.note}</p>}
                  <div className="companion-card-actions">
                    <button type="button" disabled={busy} onClick={() => resolveShare(share, 'add')}>Add word</button>
                    <button type="button" disabled={busy} onClick={() => void requestDismissShare(share)}>Not now</button>
                  </div>
                </article>)}
            </section>}

            <details className="companion-sidebar-details">
              <summary aria-label="More companion tools"><Ellipsis size={16} aria-hidden="true" /><span>More</span></summary>
              <div className="companion-sidebar-popover">
              <strong className="companion-popover-title">Companion tools</strong>
              {blockedCompanions.length > 0 && <section className="companion-list-section">
                <h2>Blocked learners <span>{blockedCompanions.length}</span></h2>
                {blockedCompanions.map((user) => <article className="companion-person-card companion-blocked-card" key={user.id}>
                  <div className="companion-person"><img src={avatarDataUri(user.avatarSeed)} alt="" /><div><strong>{user.username}</strong><span className="companion-status-tag blocked">Blocked</span></div></div>
                  <button type="button" disabled={busy} onClick={() => void confirmedAction(user, 'unblock')}>Unblock</button>
                </article>)}
              </section>}
              <details className="companion-share-tools" ref={shareTools}>
                <summary className="companion-share-tools-toggle">
                  <span>Share a word from your deck</span><ChevronDown size={15} aria-hidden="true" />
                </summary>
                <label className="companion-field">Find a word
                  <input value={shareQuery} onChange={(event) => { setShareQuery(event.target.value); setSelectedCardId('') }} placeholder="German or meaning" />
                </label>
                <div className="shared-word-results" role="group" aria-label="Words to share">
                  {matchingCards.slice(0, 6).map((card) => <button key={card.id} type="button" className={selectedCardId === card.id ? 'selected' : ''} aria-pressed={selectedCardId === card.id} onClick={() => setSelectedCardId(card.id)}>
                    <strong lang="de">{card.prompt}</strong><span>{card.meaning}</span>
                  </button>)}
                  {!matchingCards.length && <p className="companion-empty-note">No matching shareable active words.</p>}
                </div>
                {selectedCardId && <>
                  <label className="companion-field">Short note (optional)
                    <textarea maxLength={240} value={shareNote} onChange={(event) => setShareNote(event.target.value)} placeholder="Why did this word stand out?" />
                    <small>{shareNote.length}/240</small>
                  </label>
                  <div className="companion-share-recipients">
                    {connectedCompanions.map((user) => <button className="companion-primary-button" disabled={busy} key={user.id} type="button" onClick={() => { const card = cards.find((item) => item.id === selectedCardId); if (card) void requestShareWord(user, card) }}>Share with {user.username}</button>)}
                  </div>
                </>}
              </details>
              <div className="companion-email-setting">
                <span>Email notifications</span>
                <button className="app-toggle" type="button" role="switch" aria-label="Email notifications" aria-checked={emailsEnabled} disabled={busy} onClick={() => {
                  const value = !emailsEnabled
                  void run(async () => { await request('/settings', { emailsEnabled: value }); setEmailsEnabled(value) })
                }}>
                  <span aria-hidden="true" />
                </button>
              </div>
              {accountId && <div className="companion-email-setting">
                <span>Save recent chats on this device</span>
                <button className="app-toggle" type="button" role="switch" aria-label="Save recent chats on this device" aria-checked={persistentCacheEnabled} disabled={busy} onClick={() => void togglePersistentCache()}>
                  <span aria-hidden="true" />
                </button>
              </div>}
              <p className="companion-empty-note">Saved chats can be seen by someone using this browser. Turn this off on a shared device to remove them.</p>
              </div>
            </details>
            </>}
          </>}
        </aside>

        <section className="companion-chat-panel" aria-label="Direct messages">
          <div className="companion-chat-toolbar">
            <button className="companion-deck-toggle" type="button" onClick={backToDeck} aria-label="Back to deck" title="Back to deck">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="companion-chat-surface">
          {sidebarView === 'groups' && selectedGroup ? <GroupConversation key={selectedGroup.id} group={selectedGroup} cache={groupCache} outbox={outbox} canModerate={Boolean(groupDirectory?.canModerate)} onClose={closeGroup} reload={reloadGroups} wordTools={wordTools}
            shareableCards={cards.filter((card) => card.status === 'active' && isShareableCard(card))} cardPayload={sharedCardPayload}
            cardInDeck={(card, id) => deckWordKeys.has(wordKey(card)) || cards.some((item) => item.sharedFrom?.shareId === id)}
            onReceiveWord={onReceiveWord} onNotify={onNotify} />
          : sidebarView === 'chats' && openingChat ? <>
            <header className="companion-chat-header">
              <img src={avatarDataUri(openingChat.avatarSeed)} alt="" />
              <div className="companion-chat-identity"><h2>{openingChat.username}</h2><span className="companion-status-tag connected">Connected</span></div>
            </header>
            <div className="companion-chat-stream" ref={chatStream} role="log" aria-label={`Messages with ${openingChat.username}`} aria-live="polite">
              <CompanionLoader label="Opening conversation" />
              <PendingChatMessages items={pendingMessages} outbox={outbox} />
            </div>
            <form className="companion-chat-composer" onSubmit={sendMessage}>
              <label className="companion-visually-hidden" htmlFor="opening-companion-message">Message {openingChat.username}</label>
              <div className="companion-composer-input">
                <textarea ref={messageComposer} id="opening-companion-message" rows={1} maxLength={2000} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Write a message…" />
                <button className="companion-send-button" type="submit" disabled={!messageDraft.trim()}>Send</button>
              </div>
              <div className="companion-composer-footer"><span>{messageDraft.length}/2000</span></div>
            </form>
          </> : sidebarView === 'chats' && selectedChat ? <>
            <header className="companion-chat-header">
              <img src={avatarDataUri(selectedChat.companion.avatarSeed)} alt="" />
              <div className="companion-chat-identity"><h2>{selectedChat.companion.username}</h2><span className="companion-status-tag connected">Connected</span></div>
              {practice?.status === 'active' && ((practice.role === 'helper' && ((!practice.answer && !practice.feedback && chatTyping?.id === selectedChat.id && chatTyping.typing) || (practice.answer && !practice.feedback))) || (practice.role === 'learner' && !practice.answer && !practice.feedback)) && <div className="companion-practice-presence" role="status">
                <img src={avatarDataUri(selectedChat.companion.avatarSeed)} alt="" />
                <span>{selectedChat.companion.username} is {practice.role === 'helper' && !practice.answer && chatTyping?.id === selectedChat.id && chatTyping.typing ? 'typing' : 'waiting'}</span>
              </div>}
              {!practice && <div className="companion-chat-header-actions">
                <details className="companion-practice-fab" ref={practicePicker} onToggle={onChatDetailsToggle}>
                  <summary className="companion-header-pill" aria-label="Review together" title="Review together"><BookOpen size={16} aria-hidden="true" /></summary>
                  <div className="companion-practice-fab-panel">
                    <div className="group-popover-heading"><strong>Review together</strong></div>
                    <p>Five reviewed words, chosen at random.</p>
                    <div className="companion-field">Limit to a lesson or topic (optional)
                      <MenuSelect ariaLabel="Lesson or topic for practice" value={practiceTag} onChange={setPracticeTag} options={[{ value: '', label: 'All reviewed words' }, ...practiceTags.map((tag) => ({ value: tag, label: tag }))]} />
                    </div>
                    <div className="companion-card-actions"><button type="button" disabled={busy} onClick={() => void startPractice()}>Ask to practise</button></div>
                  </div>
                </details>
                <button className="companion-header-pill" type="button" aria-label="Search this conversation" aria-pressed={searchOpen} disabled={chatUpdating} onClick={toggleSearch}><Search size={14} aria-hidden="true" /><span>Search</span></button>
                <details className="companion-row-menu companion-chat-menu" onToggle={onChatDetailsToggle}>
                  <summary className="companion-header-pill" aria-label="Conversation actions"><Ellipsis size={15} aria-hidden="true" /><span>More</span></summary>
                  <div className="companion-row-popover">
                    <button type="button" onClick={(event) => { closePopover(event); void requestDeleteChat() }}>Delete conversation</button>
                  </div>
                </details>
              </div>}
            </header>
            {!practice && searchOpen && <div className="companion-search-panel" inert={chatUpdating}>
              <div className="companion-message-search">
                <Search size={14} aria-hidden="true" />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchFor(null) }} placeholder="Search words or phrases" aria-label="Search this conversation" maxLength={100} autoFocus />
                {searchQuery && <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')}><X size={13} aria-hidden="true" /></button>}
              </div>
              {searchTerm.length >= 2 && (searchState?.chatId === searchFor && searchState.query === searchTerm
                ? searchState.messages.length
                  ? <>
                    <ul className="companion-search-results">
                      {searchState.messages.map((result) => {
                        const snippet = matchSnippet(result, searchTerm)
                        return <li key={result.id}>
                          <button type="button" disabled={loadingOlder} onClick={() => void showSearchResult(result)}>
                            <span><strong>{result.isMine ? 'You' : selectedChat.companion.username}</strong><time dateTime={result.createdAt}>{formatChatTime(result.createdAt)}</time></span>
                            <span>{snippet ? <>{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</> : result.text}</span>
                          </button>
                        </li>
                      })}
                    </ul>
                    {searchState.hasMore && <p className="companion-search-note">Showing the 30 most recent matches.</p>}
                  </>
                  : <p className="companion-search-note">No messages match “{searchTerm}”.</p>
                : <CompanionLoader label="Searching" compact />)}
            </div>}
            {!practice && <aside className="companion-practice-nudge" aria-label="Practice suggestion">
              <p>Try using a recently reviewed word in a sentence.</p>
            </aside>}
            {practice ? <CompanionPracticeSession
              practice={practice}
              companionName={selectedChat.companion.username}
              answer={practiceAnswer}
              busy={busy}
              onAnswerChange={(value) => { setPracticeAnswer(value); publishTyping(selectedChat.id, Boolean(value.trim())) }}
              onAnswerBlur={() => publishTyping(selectedChat.id, false)}
              onSubmitAnswer={submitPracticeAnswer}
              onDecision={decidePractice}
            /> : <>
            {chatError && <p className="companion-alert" role="alert">{chatError}</p>}
            <div className="companion-chat-stream" ref={chatStream} role="log" aria-label={`Messages with ${selectedChat.companion.username}`} aria-live="polite" aria-busy={chatUpdating}>
              <ChatMessageList updating={chatUpdating}>
              {hasOlderMessages && <button className="companion-load-older" type="button" disabled={loadingOlder || busy || chatUpdating} onClick={loadOlderMessages}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
              {chatLoading ? <CompanionLoader label="Loading conversation" /> : chatMessages.length === 0 && pendingMessages.length === 0
                ? <div className="companion-chat-empty"><img className="companion-welcome-logo" src="/app-icon.svg" alt="" /><p>Start a thoughtful conversation.</p><span>Share a word, ask a question, or encourage today’s practice.</span></div>
                : chatMessages.map((chatMessage) => <article className={`companion-message-row${highlightId === chatMessage.id ? ' highlighted' : ''}`} id={`companion-message-${chatMessage.id}`} key={chatMessage.id}>
                  <div className="companion-message-content">
                    {chatMessage.replyTo && <button className="companion-reply-quote" style={replyColor(chatMessage.replyTo.id)} type="button" onClick={() => jumpToMessage(chatMessage.replyTo!.id)} aria-label={`Replying to ${chatMessage.replyTo.isMine ? 'you' : selectedChat.companion.username}: ${chatMessage.replyTo.text}`}>
                      <strong>{chatMessage.replyTo.isMine ? 'You' : selectedChat.companion.username}</strong><span>{chatMessage.replyTo.text}</span>
                    </button>}
                    <div className="companion-message-meta">
                      <strong>{chatMessage.isMine ? 'You' : selectedChat.companion.username}</strong>
                      <time dateTime={chatMessage.createdAt}>{formatChatTime(chatMessage.createdAt)}</time>
                      {chatMessage.isMine && chatMessage.kind !== 'unsent' && <MessageReceipt status={chatMessage.receipt ?? 'sent'} />}
                      {chatMessage.editedAt && <span className="companion-edited">edited</span>}
                      {repliedToIds.has(chatMessage.id) && <span className="companion-reply-dot" style={replyColor(chatMessage.id)} title="Has a reply" aria-hidden="true" />}
                    </div>
                    {chatMessage.kind === 'unsent'
                      ? <p className="companion-message-unsent">Message unsent</p>
                      : chatMessage.kind === 'word' && chatMessage.card
                      ? <div className="companion-word-card">
                        <span className="companion-word-card-label">Shared a word <em>{chatMessage.card.category}</em></span>
                        <p className="companion-word-card-prompt" lang="de">{chatMessage.card.prompt}</p>
                        {chatMessage.card.plural && <small>Plural: <span lang="de">{chatMessage.card.plural}</span></small>}
                        <p className="companion-word-card-meaning">{chatMessage.card.meaning}</p>
                        <p className="companion-word-card-example" lang="de">{chatMessage.card.example}</p>
                        {chatMessage.card.translation && <p className="companion-word-card-translation">{chatMessage.card.translation}</p>}
                        {!chatMessage.isMine && (deckWordKeys.has(wordKey(chatMessage.card)) || cards.some((card) => card.sharedFrom?.shareId === chatMessage.id)
                          ? <span className="companion-word-card-status">In your deck</span>
                          : <button className="companion-word-card-add" type="button" onClick={() => addChatWord(chatMessage)}>Add to deck</button>)}
                      </div>
                      : editing?.messageId === chatMessage.id
                      ? <form className="companion-edit-form" onSubmit={submitEdit}>
                        <textarea rows={2} maxLength={2000} value={editing.text} autoFocus aria-label="Edit your message" onChange={(event) => setEditing({ ...editing, text: event.target.value })} onKeyDown={(event) => {
                          if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) }
                          else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
                        }} />
                        <div className="companion-card-actions">
                          <button type="submit" disabled={busy || !editing.text.trim() || editing.text.trim() === chatMessage.text}>Save</button>
                          <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </form>
                      : <MessageWords id={chatMessage.id} text={chatMessage.text} tools={wordTools} />}
                    {chatMessage.kind === 'text' && correcting?.messageId === chatMessage.id && <form className="companion-correction-form" onSubmit={submitCorrection}>
                      <label>Suggested sentence
                        <textarea lang="de" rows={2} maxLength={2000} value={correcting.text} onChange={(event) => setCorrecting({ ...correcting, text: event.target.value })} autoFocus />
                      </label>
                      {correcting.text.trim() && correcting.text.trim() !== chatMessage.text && <div className="companion-correction-preview" aria-label="Preview of your suggestion">
                        <CorrectionDiff original={chatMessage.text} corrected={correcting.text.trim()} />
                      </div>}
                      <div className="companion-correction-tags" role="group" aria-label="What changed (optional, up to 3)">
                        {Object.entries(correctionTagLabels).map(([tag, label]) => <button key={tag} type="button" aria-pressed={correcting.tags.includes(tag)} disabled={!correcting.tags.includes(tag) && correcting.tags.length >= 3} onClick={() => toggleCorrectionTag(tag)}>{label}</button>)}
                      </div>
                      <label>Short note (optional)
                        <input maxLength={200} value={correcting.note} onChange={(event) => setCorrecting({ ...correcting, note: event.target.value })} placeholder="e.g. The verb goes in second position" />
                      </label>
                      <p>Be kind and specific: say what to revisit and why.</p>
                      <div className="companion-card-actions">
                        <button type="submit" disabled={busy || !correcting.text.trim() || correcting.text.trim() === chatMessage.text}>Send suggestion</button>
                        <button type="button" disabled={busy} onClick={() => setCorrecting(null)}>Cancel</button>
                      </div>
                    </form>}
                    {chatMessage.kind === 'text' && chatMessage.correction && <div className="companion-correction">
                      <span className="companion-correction-label">{chatMessage.correction.approved ? <><Check size={12} aria-hidden="true" /> Looks good</> : 'Suggested rewrite'} · {chatMessage.correction.byMe ? 'by you' : `by ${selectedChat.companion.username}`}</span>
                      {chatMessage.correction.text && <CorrectionDiff original={chatMessage.text} corrected={chatMessage.correction.text} />}
                      {!!chatMessage.correction.tags?.length && <div className="companion-correction-tags static">
                        {chatMessage.correction.tags.map((tag) => <span key={tag}>{correctionTagLabels[tag] ?? tag}</span>)}
                      </div>}
                      {chatMessage.correction.note && <p className="companion-correction-note">{chatMessage.correction.note}</p>}
                      {chatMessage.correction.byMe
                        ? chatMessage.correction.response && <span className="companion-correction-status">{chatMessage.correction.response === 'saved' ? 'They saved it to their deck' : 'They said thanks'}</span>
                        : chatMessage.correction.response === 'saved'
                          ? <span className="companion-correction-status">Saved to your deck</span>
                          : savingCorrection?.messageId === chatMessage.id
                            ? <form className="companion-correction-save" onSubmit={(event) => { event.preventDefault(); saveCorrection(chatMessage, savingCorrection.meaning) }}>
                              <input value={savingCorrection.meaning} maxLength={200} onChange={(event) => setSavingCorrection({ ...savingCorrection, meaning: event.target.value })} placeholder="What does it mean? (English)" aria-label="English meaning" autoFocus />
                              <button type="submit" disabled={busy || !savingCorrection.meaning.trim()}>Save</button>
                              <button type="button" onClick={() => setSavingCorrection(null)}>Cancel</button>
                            </form>
                            : <div className="companion-correction-actions">
                              {chatMessage.correction.response === 'thanks'
                                ? <span className="companion-correction-status">You said thanks</span>
                                : <button type="button" disabled={busy} onClick={() => void run(() => respondToCorrection(chatMessage, 'thanks'))}>Thanks</button>}
                              {!chatMessage.correction.approved && <button type="button" disabled={busy} onClick={() => setSavingCorrection({ messageId: chatMessage.id, meaning: '' })}>Add to my deck</button>}
                            </div>}
                    </div>}
                    {chatMessage.kind !== 'unsent' && <div className="companion-message-tools">
                      {chatMessage.reactions.map((reaction) => <button className={`companion-reaction${reaction.mine ? ' mine' : ''}`} key={reaction.emoji} type="button" aria-pressed={reaction.mine} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => void toggleReaction(chatMessage, reaction.emoji)}>
                        <span aria-hidden="true">{reaction.emoji}</span>{reaction.count}
                      </button>)}
                      {reactionPickerFor === chatMessage.id
                        ? <span className="companion-reaction-picker" role="group" aria-label="Choose a reaction">
                          {reactionOptions.map((emoji) => <button key={emoji} type="button" aria-label={`React with ${emoji}`} onClick={() => void toggleReaction(chatMessage, emoji)}>{emoji}</button>)}
                        </span>
                        : <button className="companion-tool-button" type="button" aria-label="Add reaction" onClick={() => setReactionPickerFor(chatMessage.id)}><SmilePlus size={15} aria-hidden="true" /></button>}
                      <button className="companion-tool-button" type="button" aria-label={`Reply to ${chatMessage.isMine ? 'your message' : selectedChat.companion.username}`} onClick={() => startReply(chatMessage)}><Reply size={15} aria-hidden="true" /></button>
                      {chatMessage.kind === 'text' && <button className="companion-tool-button" type="button" aria-label="Look up words in this message" aria-pressed={wordChipsFor === chatMessage.id} title="Look up words" onClick={() => wordTools.toggleChips(chatMessage.id)}><Languages size={15} aria-hidden="true" /></button>}
                      {!chatMessage.isMine && chatMessage.kind === 'text' && !chatMessage.correction && correcting?.messageId !== chatMessage.id && <>
                        <button className="companion-review-pill" type="button" disabled={busy} onClick={() => startCorrection(chatMessage)}><SpellCheck size={13} aria-hidden="true" /><span>Suggest edit</span></button>
                        <button className="companion-review-pill" type="button" disabled={busy} onClick={() => approveMessage(chatMessage)}><Check size={13} aria-hidden="true" /><span>Looks good</span></button>
                      </>}
                      {canModify(chatMessage) && <MessageActionMenu label="Edit or unsend this message" open={messageMenu === chatMessage.id} onOpenChange={(open) => setMessageMenu(open ? chatMessage.id : null)} actions={[
                        ...(chatMessage.kind === 'text' && !chatMessage.correction ? [{ label: 'Edit message', onSelect: () => setEditing({ messageId: chatMessage.id, text: chatMessage.text }) }] : []),
                        { label: 'Unsend', danger: true, onSelect: () => void requestUnsend(chatMessage) },
                      ]} />}
                      {!chatMessage.isMine && <MessageActionMenu label={`Actions for message from ${selectedChat.companion.username}`} open={messageMenu === chatMessage.id} onOpenChange={(open) => setMessageMenu(open ? chatMessage.id : null)} actions={[
                        { label: chatMessage.reported ? 'Reported' : 'Report message', disabled: chatMessage.reported, onSelect: (anchor) => { reportAnchor.current = anchor; setReportingMessageId(chatMessage.id) } },
                      ]} />}
                    </div>}
                  </div>
                </article>)}
              </ChatMessageList>
              <PendingChatMessages items={pendingMessages} outbox={outbox} />
              {awayFromBottom && <button className="companion-scroll-bottom" type="button" aria-label="Scroll to latest messages" onClick={() => {
                const element = chatStream.current
                if (element) element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
              }}><ChevronDown size={18} aria-hidden="true" /></button>}
            </div>
            {(chatTyping?.id === selectedChat.id && chatTyping.typing) && <div className="companion-chat-statuses">
              {chatTyping?.id === selectedChat.id && chatTyping.typing && <p className="companion-chat-status typing" role="status">{selectedChat.companion.username} is typing…</p>}
            </div>}
            <form className="companion-chat-composer" onSubmit={sendMessage}>
              <label className="companion-visually-hidden" htmlFor="companion-message">Message {selectedChat.companion.username}</label>
              {replyingTo && <div className="companion-reply-bar" style={replyColor(replyingTo.id)}>
                <span>Replying to <strong>{replyingTo.isMine ? 'yourself' : selectedChat.companion.username}</strong><em>{replyingTo.text}</em></span>
                <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={14} aria-hidden="true" /></button>
              </div>}
              <div className="companion-composer-input">
                <textarea ref={messageComposer} id="companion-message" rows={1} maxLength={2000} value={messageDraft} onChange={(event) => { setMessageDraft(event.target.value); publishTyping(selectedChat.id, Boolean(event.target.value.trim())) }} onBlur={() => publishTyping(selectedChat.id, false)} placeholder="Write a message…" />
                <button className="companion-send-button" type="submit" disabled={!messageDraft.trim()}>Send</button>
              </div>
              <div className="companion-composer-footer">
                <details className="companion-word-picker" ref={wordPicker} onToggle={onChatDetailsToggle}>
                  <summary><BookOpen size={13} aria-hidden="true" /><span>Share a word</span></summary>
                  <div className="companion-word-picker-panel">
                    <input value={wordPickerQuery} onChange={(event) => setWordPickerQuery(event.target.value)} placeholder="Search your words…" aria-label="Search your words" />
                    <div className="companion-word-picker-results" role="group" aria-label="Words to share in this chat">
                      {pickerCards.map((card) => <button key={card.id} type="button" disabled={busy} onClick={() => void requestWordCard(card)}>
                        <strong lang="de">{card.prompt}</strong><span>{card.meaning}</span>
                      </button>)}
                      {!pickerCards.length && <p className="companion-empty-note">No matching shareable words.</p>}
                    </div>
                  </div>
                </details>
                <span>{messageDraft.length}/2000</span>
              </div>
            </form>
            {reportingMessageId && <ReportPopover key={reportingMessageId} anchorRef={reportAnchor} title="Report message" onClose={closeReport} onSubmit={(reason, details) => reportMessage(reportingMessageId, reason, details)} />}
            </>}
          </> : <div className="companion-chat-welcome">
            <img className="companion-welcome-logo" src="/app-icon.svg" alt="" />
            <h2>Your learning community</h2>
            <p>Choose a connected companion to start a private conversation about German, share a useful word, or cheer each other on.</p>
            <span>Only you and your companion can see your messages.</span>
          </div>}
          </div>
        </section>
      </div>
    </div>
  )
}
