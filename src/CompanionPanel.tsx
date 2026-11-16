import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronDown, ChevronLeft, Ellipsis, Inbox, MessageCircle, Send } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useFormValidation } from './formValidation'
import type { Card } from './deckImport'

type Profile = { id: string; username: string; avatarSeed: string }
type Companion = Profile & {
  status: 'incoming' | 'outgoing' | 'connected' | 'blocked'
  canNudge?: boolean
  nudgeAt?: string
}
type Action = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'
type ChatMessage = {
  id: string
  senderId: string
  isMine: boolean
  text: string
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

const shareableCategories = new Set(['noun', 'verb', 'adjective', 'adverb', 'numeral', 'phrase'])

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

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messages = new Map(current.map((message) => [message.id, message]))
  let changed = false
  incoming.forEach((message) => {
    const previous = messages.get(message.id)
    if (!previous || previous.reported !== message.reported || previous.text !== message.text) changed = true
    messages.set(message.id, message)
  })
  if (!changed) return current
  return [...messages.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function CompanionPanel({
  cards,
  onReceiveWord,
  onBack,
}: {
  cards: Card[]
  onReceiveWord: (share: SharedWordPreview) => 'added' | 'already-present' | false
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
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ user: Profile; action: 'block' | 'remove' } | null>(null)
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
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false)
  const [shareQuery, setShareQuery] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')
  const [shareNote, setShareNote] = useState('')
  const messageEnd = useRef<HTMLDivElement>(null)
  const messageComposer = useRef<HTMLTextAreaElement>(null)
  const shareTools = useRef<HTMLDetailsElement>(null)
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
    if (selectedChatId.current !== chatId) return
    setChatMessages((current) => mode === 'replace' ? data.messages : mergeMessages(current, data.messages))
    if (mode === 'replace' || before) setHasOlderMessages(data.hasMore)
    setChatError(null)
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
      setConfirmDeleteChat(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const newestMessageId = chatMessages.at(-1)?.id ?? null
  useEffect(() => {
    const composer = messageComposer.current
    if (!composer) return
    composer.style.height = 'auto'
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`
  }, [messageDraft])

  useEffect(() => {
    if (!newestMessageId) {
      lastScrolledMessage.current = null
      return
    }
    if (newestMessageId !== lastScrolledMessage.current) {
      messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      lastScrolledMessage.current = newestMessageId
    }
  }, [newestMessageId])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
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
      setConfirm(null)
      setMessage(choice === 'request' ? 'Request sent. It will appear in their companion panel.' : 'Companions updated.')
      await load()
    })
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
    setConfirmDeleteChat(false)
  }

  const backToDeck = () => {
    closeChat()
    onBack()
  }

  const sendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedChat || !messageDraft.trim()) return
    const text = messageDraft.trim()
    const chatId = selectedChat.id
    void run(async () => {
      const data = await request(`/chats/${chatId}/messages`, { text }) as { message: ChatMessage }
      if (!data.message?.id) throw new Error('The chat service returned an incomplete response.')
      setChatMessages((current) => mergeMessages(current, [data.message]))
      setMessageDraft('')
      setChatError(null)
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
      setMessage('Conversation hidden from your chat list.')
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
      setMessage('Thanks. Your report was recorded.')
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
      setMessage(`A gentle reminder was sent to ${user.username}.`)
    })
  }

  const sendWord = (recipient: Profile) => {
    const card = cards.find((item) => item.id === selectedCardId && item.status === 'active' && isShareableCard(item))
    if (!card) return
    void run(async () => {
      await request('/share', {
        recipientId: recipient.id,
        card: {
          prompt: card.prompt,
          ...(card.article ? { article: card.article } : {}),
          meaning: card.meaning,
          ...(card.plural ? { plural: card.plural } : {}),
          example: card.example,
          ...(card.translation ? { translation: card.translation } : {}),
          category: card.category,
        },
        ...(shareNote.trim() ? { note: shareNote.trim() } : {}),
      })
      setSelectedCardId('')
      setShareNote('')
      setShareQuery('')
      if (shareTools.current) shareTools.current.open = false
      setMessage(`Word shared with ${recipient.username}.`)
    })
  }

  const resolveShare = (share: SharedWordPreview, choice: 'add' | 'dismiss') => {
    void run(async () => {
      const receiveResult = choice === 'add' ? onReceiveWord(share) : false
      if (choice === 'add' && !receiveResult) return
      await request(`/shares/${share.id}/${choice === 'add' ? 'add' : 'dismiss'}`, {})
      setSharedWords((current) => current.filter((item) => item.id !== share.id))
      setMessage(choice === 'add'
        ? receiveResult === 'added'
          ? `${share.card.prompt} was added to your deck, shared by ${share.sender.username}.`
          : `You already had ${share.card.prompt} in your deck.`
        : 'Word set aside.')
    })
  }

  const matchingCards = cards.filter((card) => card.status === 'active' && isShareableCard(card) && (!shareQuery.trim()
    || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(shareQuery.trim().toLocaleLowerCase())))
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
          ? <><button type="button" disabled={busy} onClick={(event) => { closePopover(event); action(user, 'accept') }}>Accept request</button><button type="button" disabled={busy} onClick={(event) => { closePopover(event); action(user, 'decline') }}>Decline request</button></>
          : <button type="button" disabled={busy} onClick={(event) => { closePopover(event); action(user, 'cancel') }}>Cancel request</button>}
        <button className="danger" type="button" disabled={busy} onClick={(event) => { closePopover(event); setConfirm({ user, action: 'block' }) }}>Block learner</button>
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
          {message && <p className="companion-notice" role="status">{message}</p>}
          {loading ? <p className="companion-empty-note">Loading your connections…</p> : !loaded ? (
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
                  <button type="button" disabled={busy} onClick={() => setConfirm({ user: found, action: 'block' })}>Block</button>
                </div>}
            </section>}

            <nav className="companion-sidebar-nav" aria-label="Companion views">
              <button className={sidebarView === 'chats' ? 'active' : ''} type="button" aria-pressed={sidebarView === 'chats'} onClick={() => setSidebarView('chats')}>
                <MessageCircle size={15} aria-hidden="true" /><span className="companion-nav-label">Chats</span><span className="companion-nav-count">{connectedCompanions.length}</span>{unreadCount > 0 && <b aria-label={`${unreadCount} unread chats`}>{unreadCount}</b>}
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
                          ? <button type="button" disabled={busy} onClick={(event) => { closePopover(event); sendNudge(user) }}>Send a nudge</button>
                          : <span>Nudged recently</span>}
                        {user.nudgeAt && <button type="button" disabled={busy} onClick={(event) => { closePopover(event); markNudgeRead(user) }}>Mark nudge as read</button>}
                        <button className="danger" type="button" disabled={busy} onClick={(event) => { closePopover(event); setConfirm({ user, action: 'remove' }) }}>Remove companion</button>
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
                    <button type="button" disabled={busy} onClick={() => resolveShare(share, 'dismiss')}>Not now</button>
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
                  <button type="button" disabled={busy} onClick={() => action(user, 'unblock')}>Unblock</button>
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
                    {connectedCompanions.map((user) => <button className="companion-primary-button" disabled={busy} key={user.id} type="button" onClick={() => sendWord(user)}>Share with {user.username}</button>)}
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
          {confirm && <div className="companion-confirm-card" role="group" aria-label="Confirm companion action">
            <p>{confirm.action === 'block' ? `Block ${confirm.user.username}? This ends any connection and prevents requests.` : `Remove ${confirm.user.username} from your companions?`}</p>
            <div className="companion-card-actions">
              <button type="button" disabled={busy} onClick={() => action(confirm.user, confirm.action)}>Yes, {confirm.action}</button>
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>}
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
              <details className="companion-row-menu companion-chat-menu">
                <summary aria-label="Conversation actions"><Ellipsis size={18} aria-hidden="true" /></summary>
                <div className="companion-row-popover">
                  <button type="button" onClick={(event) => { closePopover(event); setConfirmDeleteChat(true) }}>Hide conversation</button>
                </div>
              </details>
            </header>
            {confirmDeleteChat && <div className="companion-delete-confirm" role="group" aria-label="Delete conversation">
              <p>Hide this conversation from your list? Your companion keeps their copy. New messages can bring it back.</p>
              <button type="button" disabled={busy} onClick={deleteChat}>Hide conversation</button>
              <button type="button" disabled={busy} onClick={() => setConfirmDeleteChat(false)}>Keep it</button>
            </div>}
            {chatError && <p className="companion-alert" role="alert">{chatError}</p>}
            <div className="companion-chat-stream" role="log" aria-label={`Messages with ${selectedChat.companion.username}`} aria-live="polite">
              {hasOlderMessages && <button className="companion-load-older" type="button" disabled={loadingOlder || busy} onClick={loadOlderMessages}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
              {chatLoading ? <p className="companion-empty-note">Loading conversation…</p> : chatMessages.length === 0
                ? <div className="companion-chat-empty"><MessageCircle size={25} aria-hidden="true" /><p>Start a thoughtful conversation.</p><span>Share a word, ask a question, or encourage today’s practice.</span></div>
                : chatMessages.map((chatMessage) => <article className="companion-message-row" key={chatMessage.id}>
                  <div className="companion-message-content">
                    <div className="companion-message-meta">
                      <strong>{chatMessage.isMine ? 'You' : selectedChat.companion.username}</strong>
                      <time dateTime={chatMessage.createdAt}>{formatChatTime(chatMessage.createdAt)}</time>
                    </div>
                    <p className="companion-message-text">{chatMessage.text}</p>
                    {!chatMessage.isMine && <div className="companion-message-tools">
                      <details className="companion-message-menu">
                        <summary aria-label={`Actions for message from ${selectedChat.companion.username}`}><Ellipsis size={15} aria-hidden="true" /></summary>
                        <div className="companion-row-popover">
                          {chatMessage.reported ? <span>Reported</span> : <button type="button" onClick={(event) => {
                            closePopover(event)
                            setReportingMessageId(chatMessage.id)
                            setReportDetails('')
                            setReportReason('other')
                          }}>Report message</button>}
                        </div>
                      </details>
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
              <div ref={messageEnd} />
            </div>
            <form className="companion-chat-composer" onSubmit={sendMessage}>
              <label className="companion-visually-hidden" htmlFor="companion-message">Message {selectedChat.companion.username}</label>
              <div className="companion-composer-input">
                <textarea ref={messageComposer} id="companion-message" rows={1} maxLength={2000} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Write a message…" disabled={busy} />
                <button className="companion-send-button" type="submit" disabled={busy || !messageDraft.trim()}><span>Send</span><Send size={14} aria-hidden="true" /></button>
              </div>
              <div className="companion-composer-footer">
                <span>{messageDraft.length}/2000</span>
              </div>
            </form>
          </> : <div className="companion-chat-welcome">
            <span className="companion-chat-welcome-icon"><MessageCircle size={28} aria-hidden="true" /></span>
            <h2>Your learning community</h2>
            <p>Choose a connected companion to start a private conversation about German, share a useful word, or cheer each other on.</p>
            <span>Only you and your companion can see your messages.</span>
            <ArrowUpRight size={20} aria-hidden="true" />
          </div>}
          </div>
        </section>
      </div>
    </div>
  )
}
