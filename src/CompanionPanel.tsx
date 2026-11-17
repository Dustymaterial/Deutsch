import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, ChevronLeft, Ellipsis, Inbox, Check, LayoutGridCircles, Languages, MessageCircle, Reply, Search, SmilePlus, SpellCheck, X } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useFormValidation } from './formValidation'
import { cardContentKey, type Card } from './deckImport'
import { useConfirm } from './confirmContext'
import starterPack from './data/german-starter-pack.json'
import { findMeaning, findWord, indexMeanings, indexWords, normalizeWord, splitMessage, type WordEntry } from './wordLookup'
import { lookupDictionary, lookupEnglish, type Dictionary } from './dictionaryLookup'
import { loadDictionary } from './dictionaryLoader'
import { ChatWordPeek } from './ChatWordPeek'
import { CorrectionDiff } from './CorrectionDiff'
import { matchSnippet } from './messageSearch'

type Profile = { id: string; username: string; avatarSeed: string }
type Companion = Profile & {
  status: 'incoming' | 'outgoing' | 'connected' | 'blocked'
  canNudge?: boolean
  nudgeAt?: string
}
type Action = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'
type Reaction = { emoji: string; count: number; mine: boolean }
type ReplyPreview = { id: string; isMine: boolean; text: string }
const correctionTagLabels: Record<string, string> = {
  'verb-position': 'Verb position',
  'verb-form': 'Verb form',
  article: 'Article',
  case: 'Case ending',
  spelling: 'Spelling',
  'word-choice': 'Word choice',
  'word-order': 'Word order',
  tense: 'Tense',
  punctuation: 'Punctuation',
  'more-natural': 'More natural',
}
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
}
type ChatSummary = {
  id: string
  companion: Profile
  lastMessage: { text: string; isMine: boolean; createdAt: string } | null
  unread: boolean
  updatedAt: string
}
type SelectedChat = { id: string; companion: Profile }
type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other'

const reactionOptions = ['👍', '🎉', '💡', '❤️', '👏']

const replyPalette = [
  { accent: '#8fb9e6', tint: '#e8f1fb' },
  { accent: '#f0a3cf', tint: '#fbe9f3' },
  { accent: '#9fd49a', tint: '#e9f5e6' },
  { accent: '#efc36a', tint: '#fbf1d9' },
  { accent: '#b9a5e8', tint: '#f0ebfb' },
  { accent: '#84d0c8', tint: '#e3f5f3' },
]

// Message ids end in an increasing counter, so neighbouring messages get different colours.
const replyColor = (messageId: string) => {
  const color = replyPalette[(Number.parseInt(messageId.slice(-6), 16) || 0) % replyPalette.length]
  return { '--reply-accent': color.accent, '--reply-tint': color.tint } as React.CSSProperties
}

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

async function request(path: string, body?: object): Promise<unknown> {
  const response = await fetch(`/api/companions${path}`, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined)
  let data: unknown
  const bodyText = await response.text()
  try {
    data = JSON.parse(bodyText)
  } catch {
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    if (response.status === 404) {
      throw new Error(`The companion API route was not found (${status}). Restart the API server and make sure the app points to the correct API port.`)
    }
    throw new Error(`The companion service returned a non-JSON response (${status}).`)
  }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null
    throw new Error(typeof error === 'string' ? error : 'Could not complete the request.')
  }
  return data
}

function formatChatTime(value: string) {
  const date = new Date(value)
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

// Message menus sit inside a scrolling stream, so open upward when the bottom edge is too close.
const placePopover = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
  const menu = event.currentTarget
  if (!menu.open) return
  const stream = menu.closest('.companion-chat-stream')
  if (!stream) return
  menu.dataset.placement = stream.getBoundingClientRect().bottom - menu.getBoundingClientRect().bottom < 130 ? 'up' : 'down'
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
  return [...messages.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

const starterEntries = starterPack.cards.map((entry) => ({
  id: entry.id,
  source: 'starter' as const,
  prompt: entry.article ? `${entry.article} ${entry.word}` : entry.word,
  meaning: entry.meaning,
  category: entry.category,
  plural: entry.plural,
  example: entry.example,
  translation: entry.translation,
  level: entry.level,
}))
const starterWordIndex = indexWords(starterEntries)
const starterMeaningIndex = indexMeanings(starterEntries)

const distinctEntries = (entries: WordEntry[], limit: number) => entries
  .filter((entry, index, all) => all.findIndex((other) => other.prompt === entry.prompt && other.category === entry.category) === index)
  .slice(0, limit)

function CompanionLoader({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`companion-loader${compact ? ' compact' : ''}`} role="status" aria-label={label}><span /></div>
}

export function CompanionPanel({
  cards,
  onReceiveWord,
  onAddStarterWord,
  onAddDictionaryWord,
  onNotify,
  onBack,
}: {
  cards: Card[]
  onReceiveWord: (share: SharedWordPreview) => 'added' | 'already-present' | false
  onAddStarterWord: (entryId: string) => 'added' | 'already-present' | false
  onAddDictionaryWord: (entry: WordEntry) => 'added' | 'already-present' | false
  onNotify: (message: string) => void
  onBack: () => void
}) {
  const [companions, setCompanions] = useState<Companion[]>([])
  const [sharedWords, setSharedWords] = useState<SharedWordPreview[]>([])
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [emailsEnabled, setEmailsEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sidebarView, setSidebarView] = useState<'chats' | 'requests' | 'shared'>('chats')
  const [username, setUsername] = useState('')
  const [found, setFound] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const confirmDialog = useConfirm()
  const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [messageDraft, setMessageDraft] = useState('')
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState<ReportReason>('other')
  const [reportDetails, setReportDetails] = useState('')
  const [reply, setReply] = useState<{ chatId: string; message: ChatMessage } | null>(null)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [wordPickerQuery, setWordPickerQuery] = useState('')
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
  const [shareQuery, setShareQuery] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')
  const [shareNote, setShareNote] = useState('')
  const chatStream = useRef<HTMLDivElement>(null)
  const scrollOnOpen = useRef(false)
  const messageComposer = useRef<HTMLTextAreaElement>(null)
  const shareTools = useRef<HTMLDetailsElement>(null)
  const wordPicker = useRef<HTMLDetailsElement>(null)
  const selectedChatId = useRef<string | null>(null)
  const chatHistoryEntry = useRef(false)
  const lastScrolledMessage = useRef<string | null>(null)
  const { errors, validate, handleInput } = useFormValidation()

  const load = useCallback(async () => {
    const [accountData, chatData] = await Promise.all([
      request('/') as Promise<{ companions: Companion[]; sharedWords: SharedWordPreview[]; emailsEnabled: boolean }>,
      request('/chats') as Promise<{ chats: ChatSummary[] }>,
    ])
    if (!Array.isArray(accountData.companions) || !Array.isArray(accountData.sharedWords)
      || typeof accountData.emailsEnabled !== 'boolean' || !Array.isArray(chatData.chats)) {
      throw new Error('The companion service returned an incomplete response.')
    }
    setCompanions(accountData.companions)
    setSharedWords(accountData.sharedWords)
    setEmailsEnabled(accountData.emailsEnabled)
    setChats(chatData.chats)
    setError(null)
    setLoaded(true)
  }, [])

  const loadMessages = useCallback(async (
    chatId: string,
    mode: 'replace' | 'merge' = 'replace',
    before?: string,
  ) => {
    const query = before ? `?before=${encodeURIComponent(before)}` : ''
    const data = await request(`/chats/${chatId}/messages${query}`) as { messages: ChatMessage[]; hasMore: boolean }
    if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
      throw new Error('The chat service returned an incomplete response.')
    }
    if (selectedChatId.current !== chatId) return null
    setChatMessages((current) => mode === 'replace' ? data.messages.map(normalizeMessage) : mergeMessages(current, data.messages))
    if (mode === 'replace' || before) setHasOlderMessages(data.hasMore)
    setChatError(null)
    return data
  }, [])

  useEffect(() => {
    let active = true
    Promise.resolve().then(load).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load companions.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load])

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
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void loadMessages(chatId, 'merge').catch((failure: unknown) => {
        if (selectedChatId.current === chatId) setChatError(failure instanceof Error ? failure.message : 'Could not refresh messages.')
      })
    }
    const timer = window.setInterval(() => {
      refresh()
    }, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadMessages, selectedChat])

  useEffect(() => {
    const handlePopState = () => {
      if (!chatHistoryEntry.current) return
      chatHistoryEntry.current = false
      selectedChatId.current = null
      setSelectedChat(null)
      setChatMessages([])
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const replyingTo = reply && reply.chatId === selectedChat?.id ? reply.message : null

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const picker = wordPicker.current
      if (picker?.open && !picker.contains(event.target as Node)) picker.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  const chatOpen = Boolean(selectedChat)
  useEffect(() => {
    if (!chatOpen || dictionary || dictionaryFailed) return
    let active = true
    loadDictionary().then((loaded) => { if (active) setDictionary(loaded) }).catch(() => { if (active) setDictionaryFailed(true) })
    return () => { active = false }
  }, [chatOpen, dictionary, dictionaryFailed])

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
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      stream.scrollTo({ top: stream.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
      lastScrolledMessage.current = newestMessageId
    }
  }, [newestMessageId, chatLoading])

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
    setSidebarView('chats')
    void run(async () => {
      const data = await request('/chats/open', { id: user.id }) as { id: string; companion: Profile }
      if (typeof data.id !== 'string' || !data.companion) throw new Error('The chat service returned an incomplete response.')
      if (!chatHistoryEntry.current) {
        window.history.pushState({ __deutschCompanionChat: true }, '', window.location.href)
        chatHistoryEntry.current = true
      }
      selectedChatId.current = data.id
      lastScrolledMessage.current = null
      scrollOnOpen.current = true
      setSelectedChat({ id: data.id, companion: data.companion })
      setChatMessages([])
      setChatLoading(true)
      setChatError(null)
      try {
        await loadMessages(data.id)
        await load()
      } finally {
        setChatLoading(false)
      }
    })
  }

  const closeChat = () => {
    if (chatHistoryEntry.current) {
      chatHistoryEntry.current = false
      window.history.back()
    }
    selectedChatId.current = null
    setSelectedChat(null)
    setChatMessages([])
  }

  const backToDeck = () => {
    closeChat()
    onBack()
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
    let before = chatMessages[0]?.createdAt
    setLoadingOlder(true)
    try {
      for (let page = 0; !found && before && page < 20; page += 1) {
        const loaded = await loadMessages(chatId, 'merge', before)
        if (!loaded?.messages.length) break
        found = loaded.messages.some((item) => item.id === result.id)
        before = loaded.messages[0].createdAt
        if (!loaded.hasMore) break
      }
    } catch (failure) {
      setChatError(failure instanceof Error ? failure.message : 'Could not load earlier messages.')
    } finally {
      setLoadingOlder(false)
    }
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
    if (!selectedChat || !messageDraft.trim()) return
    const text = messageDraft.trim()
    const chatId = selectedChat.id
    const replyToId = replyingTo?.id
    void run(async () => {
      const data = await request(`/chats/${chatId}/messages`, { text, ...(replyToId ? { replyToId } : {}) }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      setChatMessages((current) => mergeMessages(current, [data.message]))
      setMessageDraft('')
      setReply(null)
      setChatError(replyToId && !data.message.replyTo
        ? 'Your message was sent, but replies need the latest server. Restart the API server to link replies.'
        : null)
      await load()
    })
  }

  const loadOlderMessages = () => {
    if (!selectedChat || !chatMessages.length) return
    const chatId = selectedChat.id
    setLoadingOlder(true)
    void loadMessages(chatId, 'merge', chatMessages[0].createdAt).catch((failure: unknown) => {
      setChatError(failure instanceof Error ? failure.message : 'Could not load earlier messages.')
    }).finally(() => setLoadingOlder(false))
  }

  const deleteChat = () => {
    if (!selectedChat) return
    const chatId = selectedChat.id
    void run(async () => {
      await request(`/chats/${chatId}/delete`, {})
      closeChat()
      onNotify('Conversation deleted.')
      await load()
    })
  }

  const reportMessage = (chatMessage: ChatMessage) => {
    void run(async () => {
      await request(`/messages/${chatMessage.id}/report`, {
        reason: reportReason,
        ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
      })
      setChatMessages((current) => current.map((item) => item.id === chatMessage.id ? { ...item, reported: true } : item))
      setReportingMessageId(null)
      setReportDetails('')
      setReportReason('other')
      onNotify('Thanks. Your report was recorded.')
    })
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

  const matchingCards = cards.filter((card) => card.status === 'active' && isShareableCard(card) && (!shareQuery.trim()
    || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(shareQuery.trim().toLocaleLowerCase())))
  const pickerQuery = wordPickerQuery.trim().toLocaleLowerCase()
  const pickerCards = cards
    .filter((card) => card.status === 'active' && isShareableCard(card)
      && (!pickerQuery || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(pickerQuery)))
    .sort((a, b) => Date.parse(b.lastReviewedAt ?? b.createdAt) - Date.parse(a.lastReviewedAt ?? a.createdAt))
    .slice(0, 8)
  const deckWordKeys = new Set(cards.map(cardContentKey))
  const repliedToIds = new Set(chatMessages.flatMap((item) => item.replyTo ? [item.replyTo.id] : []))
  const deckEntries = useMemo(() => cards
    .filter((card) => card.status === 'active')
    .map((card) => ({ id: card.id, source: 'deck' as const, prompt: card.prompt, meaning: card.meaning, category: card.category, plural: card.plural })), [cards])
  const deckWordIndex = useMemo(() => indexWords(deckEntries), [deckEntries])
  const deckMeaningIndex = useMemo(() => indexMeanings(deckEntries), [deckEntries])
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
    const result = entry.source === 'dictionary' ? onAddDictionaryWord(entry) : onAddStarterWord(entry.id)
    if (result === 'already-present') onNotify(`You already had ${entry.prompt} in your deck.`)
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

  return (
    <div className="companion-workspace-view">
      <div className={`companion-workspace${selectedChat && sidebarView === 'chats' ? ' chat-active' : ''}`}>
        <aside className="companion-sidebar" aria-label="Learning companions">
          <div className="companion-sidebar-heading">
            <h1>Companions</h1>
            <span className="companion-sidebar-count">{connectedCompanions.length}</span>
            <button className="companion-mobile-deck-back" type="button" onClick={backToDeck} aria-label="Back to deck" title="Back to deck">
              <ChevronLeft size={17} aria-hidden="true" />
            </button>
          </div>
          {error && <p className="companion-alert" role="alert">{error}</p>}
          {loading ? <CompanionLoader label="Loading your connections" /> : !loaded ? (
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
              <button className={sidebarView === 'chats' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'chats'} onClick={() => setSidebarView('chats')}>
                <LayoutGridCircles size={15} aria-hidden="true" /><span className="companion-nav-label">Chats</span><span className="companion-nav-count">{connectedCompanions.length}</span>{unreadCount > 0 && <b aria-label={`${unreadCount} unread chats`}>{unreadCount}</b>}
              </button>
              <button className={sidebarView === 'requests' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'requests'} onClick={() => setSidebarView('requests')}>
                <Inbox size={15} aria-hidden="true" /><span className="companion-nav-label">Requests</span><span className="companion-nav-count">{requestCount}</span>
              </button>
              <button className={sidebarView === 'shared' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'shared'} onClick={() => setSidebarView('shared')}>
                <BookOpen size={15} aria-hidden="true" /><span className="companion-nav-label">Shared words</span><span className="companion-nav-count">{sharedWords.length}</span>
              </button>
            </nav>

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
              </div>
            </details>
          </>}
        </aside>

        <section className="companion-chat-panel" aria-label="Direct messages">
          <div className="companion-chat-toolbar">
            <button className="companion-deck-toggle" type="button" onClick={backToDeck} aria-label="Back to deck" title="Back to deck">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="companion-chat-surface">
          {selectedChat ? <>
            <header className="companion-chat-header">
              <img src={avatarDataUri(selectedChat.companion.avatarSeed)} alt="" />
              <div className="companion-chat-identity"><h2>{selectedChat.companion.username}</h2><span className="companion-status-tag connected">Connected</span></div>
              <div className="companion-chat-header-actions">
                <button className="companion-header-pill" type="button" aria-label="Search this conversation" aria-pressed={searchOpen} onClick={toggleSearch}><Search size={14} aria-hidden="true" /><span>Search</span></button>
                <details className="companion-row-menu companion-chat-menu">
                  <summary className="companion-header-pill" aria-label="Conversation actions"><Ellipsis size={15} aria-hidden="true" /><span>More</span></summary>
                  <div className="companion-row-popover">
                    <button type="button" onClick={(event) => { closePopover(event); void requestDeleteChat() }}>Delete conversation</button>
                  </div>
                </details>
              </div>
            </header>
            {searchOpen && <div className="companion-search-panel">
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
            <aside className="companion-practice-nudge" aria-label="Practice suggestion">
              <p>Try using one word you reviewed recently in a sentence. A small practice moment counts.</p>
            </aside>
            {chatError && <p className="companion-alert" role="alert">{chatError}</p>}
            <div className="companion-chat-stream" ref={chatStream} role="log" aria-label={`Messages with ${selectedChat.companion.username}`} aria-live="polite">
              {hasOlderMessages && <button className="companion-load-older" type="button" disabled={loadingOlder || busy} onClick={loadOlderMessages}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
              {chatLoading ? <CompanionLoader label="Loading conversation" /> : chatMessages.length === 0
                ? <div className="companion-chat-empty"><MessageCircle size={25} aria-hidden="true" /><p>Start a thoughtful conversation.</p><span>Share a word, ask a question, or encourage today’s practice.</span></div>
                : chatMessages.map((chatMessage) => <article className={`companion-message-row${highlightId === chatMessage.id ? ' highlighted' : ''}`} id={`companion-message-${chatMessage.id}`} key={chatMessage.id}>
                  <div className="companion-message-content">
                    {chatMessage.replyTo && <button className="companion-reply-quote" style={replyColor(chatMessage.replyTo.id)} type="button" onClick={() => jumpToMessage(chatMessage.replyTo!.id)} aria-label={`Replying to ${chatMessage.replyTo.isMine ? 'you' : selectedChat.companion.username}: ${chatMessage.replyTo.text}`}>
                      <strong>{chatMessage.replyTo.isMine ? 'You' : selectedChat.companion.username}</strong><span>{chatMessage.replyTo.text}</span>
                    </button>}
                    <div className="companion-message-meta">
                      <strong>{chatMessage.isMine ? 'You' : selectedChat.companion.username}</strong>
                      <time dateTime={chatMessage.createdAt}>{formatChatTime(chatMessage.createdAt)}</time>
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
                      : <>
                        <p className="companion-message-text" onClick={(event) => {
                          const target = (event.target as HTMLElement).closest<HTMLElement>('[data-word]')
                          if (!target || window.getSelection()?.toString()) return
                          pickWord(chatMessage.id, target.dataset.word ?? '')
                        }}>{splitMessage(chatMessage.text).map((part, index) => {
                          if (!part.word) return part.text
                          const key = normalizeWord(part.text)
                          const open = activeWord?.messageId === chatMessage.id && activeWord.key === key
                          const known = Boolean(findWord(part.text, deckWordIndex, starterWordIndex))
                          return <span className={`companion-word${known ? ' known' : ''}${open ? ' active' : ''}`} key={index} data-word={part.text}>{part.text}</span>
                        })}</p>
                        {wordChipsFor === chatMessage.id && <div className="companion-word-chips" role="group" aria-label="Look up a word from this message">
                          {[...new Map(splitMessage(chatMessage.text).filter((part) => part.word).map((part) => [normalizeWord(part.text), part.text])).values()].map((word) => <button key={word} type="button" lang="de" aria-pressed={activeWord?.messageId === chatMessage.id && activeWord.key === normalizeWord(word)} onClick={() => pickWord(chatMessage.id, word)}>{word}</button>)}
                        </div>}
                        {activeWord?.messageId === chatMessage.id && <ChatWordPeek
                          key={`${activeWord.messageId}-${activeWord.key}`}
                          word={activeWord.word}
                          german={germanEntries}
                          english={englishEntries}
                          loading={!dictionary && !dictionaryFailed}
                          unavailable={dictionaryFailed}
                          inDeck={isEntryInDeck}
                          onAdd={addPeekedWord}
                          onClose={() => setActiveWord(null)}
                        />}
                      </>}
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
                      {chatMessage.kind === 'text' && <button className="companion-tool-button" type="button" aria-label="Look up words in this message" aria-pressed={wordChipsFor === chatMessage.id} title="Look up words" onClick={() => setWordChipsFor((current) => current === chatMessage.id ? null : chatMessage.id)}><Languages size={15} aria-hidden="true" /></button>}
                      {!chatMessage.isMine && chatMessage.kind === 'text' && !chatMessage.correction && correcting?.messageId !== chatMessage.id && <>
                        <button className="companion-review-pill" type="button" disabled={busy} onClick={() => startCorrection(chatMessage)}><SpellCheck size={13} aria-hidden="true" /><span>Suggest edit</span></button>
                        <button className="companion-review-pill" type="button" disabled={busy} onClick={() => approveMessage(chatMessage)}><Check size={13} aria-hidden="true" /><span>Looks good</span></button>
                      </>}
                      {canModify(chatMessage) && <details className="companion-message-menu" onToggle={placePopover}>
                        <summary aria-label="Edit or unsend this message"><Ellipsis size={15} aria-hidden="true" /></summary>
                        <div className="companion-row-popover">
                          {chatMessage.kind === 'text' && !chatMessage.correction && <button type="button" onClick={(event) => { closePopover(event); setEditing({ messageId: chatMessage.id, text: chatMessage.text }) }}>Edit message</button>}
                          <button className="danger" type="button" onClick={(event) => { closePopover(event); void requestUnsend(chatMessage) }}>Unsend</button>
                        </div>
                      </details>}
                      {!chatMessage.isMine && <details className="companion-message-menu" onToggle={placePopover}>
                        <summary aria-label={`Actions for message from ${selectedChat.companion.username}`}><Ellipsis size={15} aria-hidden="true" /></summary>
                        <div className="companion-row-popover">
                          {chatMessage.reported ? <span>Reported</span> : <button type="button" onClick={(event) => {
                            closePopover(event)
                            setReportingMessageId(chatMessage.id)
                            setReportDetails('')
                            setReportReason('other')
                          }}>Report message</button>}
                        </div>
                      </details>}
                    </div>}
                  {reportingMessageId === chatMessage.id && <form className="companion-report-form" onSubmit={(event) => { event.preventDefault(); reportMessage(chatMessage) }}>
                    <label className="companion-field">Report reason
                      <select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)}>
                        <option value="spam">Spam</option>
                        <option value="harassment">Harassment</option>
                        <option value="inappropriate">Inappropriate content</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="companion-field">Additional details (optional)
                      <textarea maxLength={500} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} />
                    </label>
                    <div className="companion-card-actions">
                      <button type="submit" disabled={busy}>Submit report</button>
                      <button type="button" disabled={busy} onClick={() => setReportingMessageId(null)}>Cancel</button>
                    </div>
                  </form>}
                  </div>
                </article>)}
            </div>
            <form className="companion-chat-composer" onSubmit={sendMessage}>
              <label className="companion-visually-hidden" htmlFor="companion-message">Message {selectedChat.companion.username}</label>
              {replyingTo && <div className="companion-reply-bar" style={replyColor(replyingTo.id)}>
                <span>Replying to <strong>{replyingTo.isMine ? 'yourself' : selectedChat.companion.username}</strong><em>{replyingTo.text}</em></span>
                <button type="button" aria-label="Cancel reply" onClick={() => setReply(null)}><X size={14} aria-hidden="true" /></button>
              </div>}
              <div className="companion-composer-input">
                <textarea ref={messageComposer} id="companion-message" rows={1} maxLength={2000} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Write a message…" disabled={busy} />
                <button className="companion-send-button" type="submit" disabled={busy || !messageDraft.trim()}>Send</button>
              </div>
              <div className="companion-composer-footer">
                <details className="companion-word-picker" ref={wordPicker}>
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
