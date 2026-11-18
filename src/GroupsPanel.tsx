import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AtSign, BookOpen, Check, ChevronDown, Ellipsis, Languages, Plus, Reply, Search, ShieldAlert, SmilePlus, SpellCheck, Users, X } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useConfirm } from './confirmContext'
import { useFormValidation } from './formValidation'
import { replyColor } from './replyColor'
import { FloatingPopover } from './FloatingPopover'
import { MessageActionMenu } from './MessageActionMenu'
import { ReportPopover, type ReportReason } from './ReportPopover'
import { MessageWords, type MessageWordTools } from './MessageWords'
import { matchSnippet } from './messageSearch'
import { CorrectionDiff } from './CorrectionDiff'
import { correctionTagLabels, reactionOptions } from './chatOptions'
import type { Card } from './deckImport'
import type { SharedWordPreview } from './CompanionPanel'
import {
  errorMessage, groupsRequest, GroupsApiError,
  type GroupDirectory, type GroupMessage, type GroupReview, type GroupSummary, type Profile,
} from './groupsApi'
import type { PersistentChatCache } from './chatPersistentCache'
import { useVisibleChatRead } from './useVisibleChatRead'
import { ChatMessageList } from './ChatMessageList'
import { useChatTyping } from './useChatTyping'
import { formatChatTime as formatTime } from './chatTime'
import { watchConversation, chatSocketActive } from './chatSocket'
import { replayUpdatesInRange } from './chatReplay'
import { useChatScrollState } from './useChatScrollState'
import { useChatOverlayHistory } from './useChatOverlayHistory'
import './Groups.css'
import { PendingChatMessages } from './PendingChatMessages'
import type { ChatOutbox } from './useChatOutbox'
import { MessageReceipt } from './MessageReceipt'
import { useChatDelivery } from './useChatDelivery'

const rulesText = 'Groups are open to every member, so anything you post can be read by all of them. Be kind and keep it about learning German. No spam, advertising, personal details or harassment. You must be at least 13. Group owners and moderators can hide messages and remove people, and you can report any message.'

const closePopover = (event: React.SyntheticEvent<HTMLElement>) => {
  const details = event.currentTarget.closest('details')
  if (details) details.open = false
}

export function GroupsSidebar({ directory, error, selectedId, onOpen, reload, invitationToken, onInvitationHandled, onNotify }: {
  directory: GroupDirectory | null
  error: string | null
  selectedId: string | null
  onOpen: (id: string) => void
  reload: () => Promise<void>
  invitationToken: string | null
  onInvitationHandled: () => void
  onNotify: (message: string, kind?: 'success' | 'error') => void
}) {
  const confirmDialog = useConfirm()
  const { errors, validate, handleInput } = useFormValidation()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [invitation, setInvitation] = useState<GroupSummary | null>(null)
  const createPopoverId = useId()
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const createPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!invitationToken) return
    let active = true
    void groupsRequest<{ group: GroupSummary }>('/invitation/resolve', { inviteToken: invitationToken })
      .then((data) => {
        if (!data.group?.id) throw new Error('The group service returned an incomplete invitation.')
        if (active) setInvitation(data.group)
      })
      .catch((failure: unknown) => {
        if (!active) return
        if (failure instanceof GroupsApiError && failure.status === 404) {
          onInvitationHandled()
          onNotify('That group is unavailable.', 'error')
        } else {
          setProblem(errorMessage(failure, 'Could not open this invitation.'))
        }
      })
    return () => { active = false }
  }, [invitationToken, onInvitationHandled, onNotify])

  useEffect(() => {
    if (!creating) return
    const focus = requestAnimationFrame(() => createPopoverRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus())
    return () => cancelAnimationFrame(focus)
  }, [creating])

  useEffect(() => {
    if (!creating) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || createPopoverRef.current?.contains(event.target) || createTriggerRef.current?.contains(event.target)) return
      setCreating(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [creating])

  const closeCreate = () => {
    setCreating(false)
    createTriggerRef.current?.focus()
  }

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await task()
    } catch (failure) {
      setProblem(errorMessage(failure, 'Could not complete that.'))
    } finally {
      setBusy(false)
    }
  }

  const acceptRules = async () => {
    if (directory?.rulesAccepted) return true
    const agreed = await confirmDialog({
      title: 'Before you join a group',
      message: rulesText,
      confirmLabel: 'I agree',
      cancelLabel: 'Not now',
    })
    if (!agreed) return false
    await groupsRequest('/rules', {})
    await reload()
    return true
  }

  const join = (group: GroupSummary) => run(async () => {
    if (!await acceptRules()) return
    await groupsRequest(`/${group.id}/join`, {})
    await reload()
    onOpen(group.id)
  })

  const joinInvitation = (group: GroupSummary) => run(async () => {
    if (!invitationToken) throw new Error('This invitation is no longer available.')
    if (!group.joined) {
      if (!await acceptRules()) return
      await groupsRequest(`/${group.id}/join`, { inviteToken: invitationToken })
    }
    await reload()
    onInvitationHandled()
    onOpen(group.id)
  })

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validate(event.currentTarget)) return
    void run(async () => {
      if (!await acceptRules()) return
      const data = await groupsRequest<{ group: GroupSummary }>('/', { name, description })
      setName('')
      setDescription('')
      setCreating(false)
      await reload()
      onOpen(data.group.id)
    })
  }

  const needle = query.trim().toLocaleLowerCase()
  const matching = (directory?.groups ?? []).filter((group) =>
    !needle || `${group.name} ${group.description}`.toLocaleLowerCase().includes(needle))
  const mine = matching.filter((group) => group.joined).sort((a, b) =>
    Date.parse(b.lastMessage?.createdAt ?? b.createdAt) - Date.parse(a.lastMessage?.createdAt ?? a.createdAt))
  const others = matching.filter((group) => !group.joined)
  const atLimit = directory ? directory.ownedCount >= directory.ownedLimit : true

  const card = (group: GroupSummary) => <article className={`group-card companion-contact-card${selectedId === group.id ? ' selected' : ''}`} key={group.id}>
    <button className="group-card-open companion-contact-open" type="button" disabled={!group.joined} onClick={() => onOpen(group.id)} aria-label={group.joined ? `Open ${group.name}${group.unreadCount ? `, ${group.unreadCount > 99 ? 'more than 99' : group.unreadCount} unread messages` : ''}${group.mentionCount ? `, ${group.mentionCount} pending mentions` : ''}` : undefined}>
      <span className="group-avatar" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase()}</span>
      <span className="group-card-copy">
        <span className="group-card-heading">
          <strong>{group.name}</strong>
          <small>{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}</small>
        </span>
        <span className="group-card-activity">
          <span className="group-card-preview">{group.joined
            ? group.lastMessage ? `${group.lastMessage.isMine ? 'You' : group.lastMessage.sender}: ${group.lastMessage.text}` : 'No messages yet'
            : group.description || `Run by ${group.owner.username}`}</span>
          {group.joined && (Boolean(group.mentionCount) || Boolean(group.unreadCount)) && <span className="group-card-signals">
            {Boolean(group.mentionCount) && <b className="group-mention-count" aria-label={`${group.mentionCount} mentions`}>@{group.mentionCount}</b>}
            {Boolean(group.unreadCount) && <span className="group-unread-dot" aria-label={`${(group.unreadCount ?? 0) > 99 ? 'More than 99' : group.unreadCount} unread messages`} />}
          </span>}
        </span>
        {group.state === 'closed' && <small className="group-card-closed">Closed to new members</small>}
      </span>
    </button>
    {!group.joined && (group.removed
      ? <span className="group-card-note">Unavailable</span>
      : group.state === 'closed'
        ? <span className="group-card-note">Closed</span>
        : <button className="group-join" type="button" disabled={busy || Boolean(directory?.suspendedUntil)} onClick={() => void join(group)}>Join</button>)}
  </article>

  return <>
    {directory?.suspendedUntil && <p className="companion-alert" role="alert">Your group access is paused until {new Date(directory.suspendedUntil).toLocaleDateString()}.</p>}
    {(error || problem) && <p className="companion-alert" role="alert">{problem ?? error}</p>}
    {invitationToken && <section className="companion-list-section" aria-label="Group invitation">
      {invitation ? <>
        <h2>Invitation to {invitation.name}</h2>
        {invitation.description && <p className="companion-empty-note">{invitation.description}</p>}
        <div className="companion-card-actions">
          <button type="button" className="companion-primary-button" disabled={busy || (!invitation.joined && invitation.state === 'closed')} onClick={() => void joinInvitation(invitation)}>{invitation.joined ? 'Open group' : invitation.state === 'closed' ? 'Group closed' : 'Join group'}</button>
          <button type="button" disabled={busy} onClick={onInvitationHandled}>Dismiss</button>
        </div>
      </> : !problem && <p className="companion-empty-note" role="status">Loading invitation…</p>}
      {problem && <button className="companion-primary-button" type="button" onClick={onInvitationHandled}>Dismiss invitation</button>}
    </section>}
    <div className="group-toolbar">
      <div className="group-search">
        <Search size={13} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a group…" aria-label="Find a group" maxLength={40} />
      </div>
      <button ref={createTriggerRef} className="group-create-toggle" type="button" aria-haspopup="dialog" aria-expanded={creating} aria-controls={creating ? createPopoverId : undefined} disabled={!directory || (atLimit && !creating)} title={atLimit ? `You run ${directory?.ownedLimit ?? 3} groups already` : undefined} onClick={() => setCreating((open) => !open)}>
        <Plus size={13} aria-hidden="true" /><span>Create</span>
      </button>
    </div>
    {creating && <FloatingPopover anchorRef={createTriggerRef} popoverRef={createPopoverRef} owner={createPopoverId} preferredWidth={340} preferredMaxHeight={640} id={createPopoverId}
      className="group-details-popover group-create-popover" role="dialog" aria-label="Create group" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCreate() }
      }}>
      <form className="group-create-form" noValidate onInput={handleInput} onSubmit={create}>
      <div className="group-popover-heading"><strong>Create group</strong></div>
      <label className="companion-field">Group name
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={40} required aria-invalid={Boolean(errors.name) || undefined} placeholder="Beginners’ corner" autoFocus />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label className="companion-field">What is it for? (optional)
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} rows={2} placeholder="Questions and practice for A1 learners" />
        <small>{description.length}/200</small>
      </label>
      <p className="group-create-note">You can run up to {directory?.ownedLimit ?? 3} groups ({directory?.ownedCount ?? 0} used). Close a group to stop new members from joining.</p>
      {problem && <p className="companion-alert" role="alert">{problem}</p>}
      <button className="companion-primary-button" type="submit" disabled={busy}>Create group</button>
      </form>
    </FloatingPopover>}
    {!directory ? <p className="companion-empty-note">Loading groups…</p> : <>
      <section className="companion-list-section" aria-labelledby="my-groups-heading">
        <h2 id="my-groups-heading">Your groups <span>{mine.length}</span></h2>
        {mine.length === 0 ? <p className="companion-empty-note">Groups you join or create appear here.</p> : <div className="group-list companion-contact-list">{mine.map(card)}</div>}
      </section>
      <section className="companion-list-section" aria-labelledby="browse-groups-heading">
        <h2 id="browse-groups-heading">Browse groups <span>{others.length}</span></h2>
        {others.length === 0 ? <p className="companion-empty-note">{needle ? 'No groups match your search.' : 'No other groups yet. Create the first one.'}</p> : <div className="group-list companion-contact-list">{others.map(card)}</div>}
      </section>
    </>}
  </>
}

const mergeMessages = (current: GroupMessage[], incoming: GroupMessage[]) => {
  const map = new Map(current.map((message) => [message.id, message]))
  let changed = false
  for (const message of incoming) {
    const previous = map.get(message.id)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(message)) changed = true
    map.set(message.id, message)
  }
  if (!changed) return current
  return [...map.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
}

export function GroupConversation({ group, cache, outbox, canModerate, onClose, reload, wordTools, shareableCards, cardPayload, cardInDeck, onReceiveWord, onNotify }: {
  group: GroupSummary
  cache: PersistentChatCache<GroupMessage>
  outbox: ChatOutbox
  canModerate: boolean
  onClose: () => void
  reload: () => Promise<void>
  wordTools: MessageWordTools
  shareableCards: Card[]
  cardPayload: (card: Card) => SharedWordPreview['card']
  cardInDeck: (card: SharedWordPreview['card'], id: string) => boolean
  onReceiveWord: (share: SharedWordPreview) => 'added' | 'already-present' | false
  onNotify: (message: string) => void
}) {
  const confirmDialog = useConfirm()
  const [cachedPage] = useState(() => cache.get(group.id))
  const [messages, setMessages] = useState<GroupMessage[]>(cachedPage?.messages ?? [])
  const [typing, setTyping] = useState<Profile[]>([])
  useEffect(() => {
    if (!typing.length) return
    const timer = window.setTimeout(() => setTyping((current) => current === typing ? [] : current), 8000)
    return () => window.clearTimeout(timer)
  }, [typing])
  const [loaded, setLoaded] = useState(Boolean(cachedPage))
  const [updating, setUpdating] = useState(Boolean(cachedPage))
  const [unavailable, setUnavailable] = useState(false)
  const [hasOlder, setHasOlder] = useState(cachedPage?.hasMore ?? false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null)
  const [practiceTargetId, setPracticeTargetId] = useState<string | null>(null)
  const usingWord = Boolean(replyTo && practiceTargetId === replyTo.id)
  const [savingSentence, setSavingSentence] = useState<{ messageId: string; meaning: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [members, setMembers] = useState<{ list: (Profile & { role: string })[]; canRemove: boolean } | null>(null)
  const [mentionsOpen, setMentionsOpen] = useState(false)
  const [mentions, setMentions] = useState<{ messages: GroupMessage[]; hasMore: boolean; cursor: GroupMessage | null } | null>(null)
  const [mentionsLoading, setMentionsLoading] = useState(false)
  const [reporting, setReporting] = useState<{ messageId: string; authorId?: string } | null>(null)
  const reportAnchor = useRef<HTMLButtonElement | null>(null)
  const closeReport = useCallback(() => setReporting(null), [])
  const [popover, setPopover] = useState<'info' | 'edit' | null>(null)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [messageCount, setMessageCount] = useState<number | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<{ query: string; messages: GroupMessage[]; hasMore: boolean } | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [messageMenu, setMessageMenu] = useState<string | null>(null)
  const [chatDetailsMenuOpen, setChatDetailsMenuOpen] = useState(false)
  const chatDetailsMenu = useRef<HTMLDetailsElement | null>(null)
  const onChatDetailsToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const target = event.currentTarget
    if (target.open) chatDetailsMenu.current = target
    else if (chatDetailsMenu.current === target) chatDetailsMenu.current = null
    setChatDetailsMenuOpen(Boolean(chatDetailsMenu.current))
  }
  const [editing, setEditing] = useState<{ messageId: string; text: string } | null>(null)
  const [correcting, setCorrecting] = useState<{ messageId: string; text: string; note: string; tags: string[] } | null>(null)
  const [savingCorrection, setSavingCorrection] = useState<{ messageId: string; authorId: string; meaning: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [wordPickerQuery, setWordPickerQuery] = useState('')
  const wordPicker = useRef<HTMLDetailsElement>(null)
  const { errors: renameErrors, validate: validateRename, handleInput: handleRenameInput } = useFormValidation()
  const popoverId = useId()
  const groupNameRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const stream = useRef<HTMLDivElement>(null)
  const [awayFromBottom] = useChatScrollState(stream, group.id)
  const stickToBottom = useRef(true)
  const firstLoad = useRef(true)
  const loadSequence = useRef(0)
  const loadingRef = useRef(false)
  const olderInFlight = useRef<{ cursor?: string } | null>(null)
  const accessDenied = useRef(false)
  const directorySignature = useRef<string | null>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const searchTerm = searchQuery.trim()
  const reconcileOutbox = outbox.reconcile
  const pendingMessages = outbox.items.filter((item) => item.kind === 'group' && item.chatId === group.id
    && !messages.some((message) => message.id === item.id))
  const sentPendingKey = pendingMessages.filter((item) => item.status === 'sent').map((item) => item.id).join(',')
  const refreshedSends = useRef(new Set<string>())
  useEffect(() => {
    let active = true
    void cache.whenReady().then(() => {
      const restored = cache.get(group.id)
      if (active && restored && firstLoad.current && !accessDenied.current) {
        setMessages(restored.messages)
        setHasOlder(restored.hasMore)
        setLoaded(true)
      }
    })
    return () => { active = false }
  }, [cache, group.id])
  useEffect(() => {
    reconcileOutbox('group', group.id, messages.map((message) => message.id))
  }, [group.id, messages, reconcileOutbox])
  const overlay = [
    reporting && 'report', savingCorrection && 'save', savingSentence && 'save-sentence', correcting && 'correct', editing && 'edit',
    reactionPickerFor && 'reaction', messageMenu && 'message-menu', chatDetailsMenuOpen && 'details-menu', popover && 'details', wordTools.activeWord && 'word',
    wordTools.wordChipsFor && 'words', mentionsOpen && 'mentions', membersOpen && 'members',
    searchOpen && 'search', replyTo && 'reply',
  ].filter(Boolean).join(',')
  useChatOverlayHistory(group.id, overlay, (top) => {
    if (top === 'report') setReporting(null)
    else if (top === 'save') setSavingCorrection(null)
    else if (top === 'save-sentence') setSavingSentence(null)
    else if (top === 'correct') setCorrecting(null)
    else if (top === 'edit') setEditing(null)
    else if (top === 'reaction') setReactionPickerFor(null)
    else if (top === 'message-menu') setMessageMenu(null)
    else if (top === 'details-menu') { if (chatDetailsMenu.current) chatDetailsMenu.current.open = false; setChatDetailsMenuOpen(false) }
    else if (top === 'details') setPopover(null)
    else if (top === 'word') wordTools.onClose()
    else if (top === 'words' && wordTools.wordChipsFor) wordTools.toggleChips(wordTools.wordChipsFor)
    else if (top === 'mentions') setMentionsOpen(false)
    else if (top === 'members') setMembersOpen(false)
    else if (top === 'search') setSearchOpen(false)
    else if (top === 'reply') setReplyTo(null)
  })
  const publishTyping = useChatTyping(
    useCallback(async (id: string, value: boolean) => { await groupsRequest(`/${id}/typing`, { typing: value }) }, []),
    useCallback((failure: unknown) => setError(errorMessage(failure, 'Could not update typing status.')), []),
  )
  const mentionQuery = draft.match(/(?:^|[\s([{])@([A-Za-z0-9_-]{0,20})$/)?.[1]

  useEffect(() => {
    if (mentionQuery === undefined || members) return
    let active = true
    void groupsRequest<{ members: (Profile & { role: string })[]; canRemove: boolean }>(`/${group.id}/members`)
      .then((data) => {
        if (!Array.isArray(data.members)) throw new Error('The group service returned an incomplete member list.')
        if (active) setMembers({ list: data.members, canRemove: data.canRemove })
      })
      .catch((failure: unknown) => { if (active) setError(errorMessage(failure, 'Could not load members for mentions.')) })
    return () => { active = false }
  }, [group.id, mentionQuery, members])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!reactionPickerFor) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setReactionPickerFor(null) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [reactionPickerFor])

  useEffect(() => {
    if (!searchOpen || searchTerm.length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      void groupsRequest<{ messages: GroupMessage[]; hasMore: boolean }>(`/${group.id}/search?q=${encodeURIComponent(searchTerm)}`)
        .then((data) => {
          if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') throw new Error('The group service returned an incomplete search response.')
          if (active) {
            setSearchState({ query: searchTerm, messages: data.messages, hasMore: data.hasMore })
            setSearchError(null)
          }
        })
        .catch((failure: unknown) => {
          if (active) setSearchError(errorMessage(failure, 'Could not search this group.'))
        })
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [group.id, searchOpen, searchTerm])

  const load = useCallback(async (replayCursor?: string, pushed?: { messages: GroupMessage[]; hasMore: boolean; group: GroupSummary; typing: Profile[]; cursor?: string; reset?: boolean }) => {
    if (olderInFlight.current && !replayCursor) return
    const sequence = ++loadSequence.current
    loadingRef.current = true
    try {
      await cache.whenReady()
      if (sequence !== loadSequence.current) return
      const cached = cache.get(group.id)
      let replayed = false
      let reset = false
      let data: { messages: GroupMessage[]; hasMore: boolean; group: GroupSummary; typing: Profile[]; cursor?: string | null }
      const cursor = replayCursor ?? cached?.cursor
      if (pushed) {
        data = { ...pushed, cursor: pushed.cursor ?? cached?.cursor }
        reset = Boolean(pushed.reset)
      } else if (cursor && cached) {
        let sync: { reset: boolean; messages?: GroupMessage[]; group?: GroupSummary; typing?: Profile[]; cursor?: string }
        try {
          sync = await groupsRequest(`/${group.id}/sync?cursor=${encodeURIComponent(cursor)}`)
        } catch (failure) {
          if (!(failure instanceof GroupsApiError) || failure.status !== 503
            || failure.message !== 'Chat replay requires a MongoDB replica set.') throw failure
          sync = { reset: true }
        }
        if (sync.reset === false && Array.isArray(sync.messages) && sync.group && Array.isArray(sync.typing) && typeof sync.cursor === 'string') {
          data = { messages: sync.messages, group: sync.group, typing: sync.typing, cursor: sync.cursor, hasMore: cached.hasMore }
          replayed = true
        } else if (sync.reset === true) {
          reset = true
          data = await groupsRequest(`/${group.id}/messages?read=0`)
        } else {
          throw new Error('The group service returned an incomplete replay response.')
        }
      } else {
        reset = !cached && !firstLoad.current
        data = await groupsRequest(`/${group.id}/messages?read=0`)
      }
      if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean' || !data.group || !Array.isArray(data.typing)) {
        throw new Error('The group service returned an incomplete response.')
      }
      if (sequence !== loadSequence.current) return
      if (!pushed) setTyping(data.typing)
      const cachedMessages = pushed && cached && !reset ? mergeMessages(cached.messages, data.messages) : replayed && cached
        ? mergeMessages(cached.messages, replayUpdatesInRange(cached.messages, data.messages)) : data.messages
      cache.set(group.id, { messages: cachedMessages, hasMore: data.hasMore, ...(data.cursor ? { cursor: data.cursor } : {}) })
      const initialLoad = firstLoad.current
      setMessages((current) => pushed && !reset ? mergeMessages(current, data.messages) : replayed
        ? mergeMessages(current, replayUpdatesInRange(current, data.messages))
        : initialLoad || reset ? data.messages : mergeMessages(current, data.messages))
      const signature = JSON.stringify([data.group.name, data.group.description, data.group.state, data.group.memberCount])
      if (directorySignature.current !== signature) {
        directorySignature.current = signature
        void reload()
      }
      if (firstLoad.current || reset) {
        firstLoad.current = false
        setHasOlder(data.hasMore)
      }
      setLoaded(true)
      setUpdating(false)
      setError(null)
    } catch (failure) {
      if (sequence !== loadSequence.current) return
      const denied = failure instanceof GroupsApiError && [401, 403, 404].includes(failure.status)
      if (denied) {
        cache.delete(group.id)
        setMessages([])
      }
      if (denied) {
        accessDenied.current = true
        setSearchState(null)
        setUnavailable(true)
      }
      setUpdating(false)
      setError(errorMessage(failure, 'Could not load messages.'))
      setLoaded(true)
    } finally {
      if (sequence === loadSequence.current) loadingRef.current = false
    }
  }, [cache, group.id, reload])

  useEffect(() => {
    if (!loaded || updating || !sentPendingKey) return
    if (chatSocketActive('group', group.id)) return
    const ids = sentPendingKey.split(',').filter((id) => !refreshedSends.current.has(id))
    if (!ids.length) return
    ids.forEach((id) => refreshedSends.current.add(id))
    void load()
  }, [loaded, updating, sentPendingKey, load, group.id])

  const beginOlderMessages = () => {
    const operation = { cursor: cache.get(group.id)?.cursor }
    olderInFlight.current = operation
    loadSequence.current += 1
    return operation
  }
  const finishOlderMessages = async (operation: { cursor?: string }) => {
    try {
      if (operation.cursor) await load(operation.cursor)
    } finally {
      if (olderInFlight.current === operation) olderInFlight.current = null
    }
  }

  const incomingMessageIds = messages.filter((message) => message.kind !== 'system' && !message.isMine).map((message) => message.id)
  const incomingIdsKey = incomingMessageIds.join(',')
  const markGroupRead = useCallback(async (id: string) => {
    const ids = incomingIdsKey ? incomingIdsKey.split(',') : []
    if (!ids.length) await groupsRequest(`/${group.id}/read`, { id, ids: [] })
    for (let offset = 0; offset < ids.length; offset += 50) {
      await groupsRequest(`/${group.id}/read`, { id, ids: ids.slice(offset, offset + 50) })
    }
  }, [group.id, incomingIdsKey])
  const onGroupRead = useCallback(() => { void reload() }, [reload])
  const onGroupReadError = useCallback((failure: unknown) => {
    setError(errorMessage(failure, 'Could not mark messages as read.'))
  }, [])
  const deliverGroup = useCallback(async (ids: string[]) => {
    await groupsRequest(`/${group.id}/delivered`, { id: ids[ids.length - 1], ids })
  }, [group.id])
  const onGroupDeliveryError = useCallback((failure: unknown) => {
    setError(errorMessage(failure, 'Could not acknowledge message delivery.'))
  }, [])
  useVisibleChatRead({
    chatKey: group.id,
    messageId: messages.findLast((message) => message.kind !== 'system')?.id ?? null,
    receiptKey: incomingIdsKey,
    enabled: loaded && !updating && !unavailable,
    stream,
    markRead: markGroupRead,
    onRead: onGroupRead,
    onError: onGroupReadError,
  })
  useChatDelivery({
    chatKey: group.id,
    messageIds: incomingMessageIds,
    enabled: loaded && !updating && !unavailable,
    deliver: deliverGroup,
    onError: onGroupDeliveryError,
  })

  useEffect(() => {
    if (!popover) return
    const focus = requestAnimationFrame(() => {
      if (popover === 'info') popoverRef.current?.focus()
      else popoverRef.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus()
    })
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target) && !groupNameRef.current?.contains(event.target)) {
        setPopover(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      cancelAnimationFrame(focus)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [popover])

  useEffect(() => {
    const refresh = (force = false) => {
      if (document.visibilityState === 'visible' && (force || !loadingRef.current) && !accessDenied.current) return load()
    }
    const onVisibilityChange = () => { void refresh() }
    const first = window.setTimeout(() => { void refresh() }, 0)
    const stopLive = watchConversation(`/api/groups/${group.id}/live`, () => refresh(true),
      (snapshot) => { void load(undefined, snapshot.page as { messages: GroupMessage[]; hasMore: boolean; group: GroupSummary; typing: Profile[] }) },
      (value) => setTyping((current) => value.typing ? [...current.filter((person) => person.id !== value.user.id), value.user] : current.filter((person) => person.id !== value.user.id)), () => cache.get(group.id))
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(first)
      stopLive()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      loadSequence.current += 1
      loadingRef.current = false
    }
  }, [group.id, load, cache])

  useEffect(() => {
    const element = stream.current
    if (!element) return
    if (stickToBottom.current || element.scrollHeight - element.scrollTop - element.clientHeight < 160) {
      element.scrollTop = element.scrollHeight
      if (messages.length) stickToBottom.current = false
    }
  }, [messages])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (failure) {
      setError(errorMessage(failure, 'Could not complete that.'))
    } finally {
      setBusy(false)
    }
  }

  const loadOlder = () => {
    const oldest = messages[0]
    const element = stream.current
    if (!oldest || !element) return
    const operation = beginOlderMessages()
    setLoadingOlder(true)
    const previousHeight = element.scrollHeight
    void (async () => {
      let problem: unknown = null
      try {
        const data = await groupsRequest<{ messages: GroupMessage[]; hasMore: boolean }>(`/${group.id}/messages?before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}`)
        setMessages((current) => mergeMessages(current, data.messages))
        setHasOlder(data.hasMore)
        requestAnimationFrame(() => { element.scrollTop += element.scrollHeight - previousHeight })
      } catch (failure) {
        problem = failure
      } finally {
        await finishOlderMessages(operation)
        if (problem) setError(errorMessage(problem, 'Could not load earlier messages.'))
        setLoadingOlder(false)
      }
    })()
  }

  const send = (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    if (usingWord && text.length > 500) { setError('Keep your practice sentence within 500 characters.'); return }
    try {
      outbox.enqueue({ kind: 'group', chatId: group.id, text, ...(usingWord ? { wordPractice: true } : {}), ...(replyTo ? {
        replyTo: { id: replyTo.id, isMine: replyTo.isMine, text: replyTo.text },
      } : {}) })
      stickToBottom.current = true
      setDraft('')
      publishTyping(group.id, false)
      setReplyTo(null)
      setPracticeTargetId(null)
      setError(null)
      requestAnimationFrame(() => { if (stream.current) stream.current.scrollTop = stream.current.scrollHeight })
    } catch (failure) {
      setError(errorMessage(failure, 'Could not send this message.'))
    }
  }

  const toggleReaction = (message: GroupMessage, emoji: string) => {
    const mine = message.reactions.find((reaction) => reaction.mine)?.emoji
    setReactionPickerFor(null)
    void run(async () => {
      const data = await groupsRequest<{ reactions: GroupMessage['reactions'] }>(`/${group.id}/messages/${message.id}/reaction`, { emoji: mine === emoji ? null : emoji })
      if (!Array.isArray(data.reactions)) throw new Error('The group service returned an incomplete response.')
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, reactions: data.reactions } : item))
    })
  }

  const startWordPractice = (message: GroupMessage, revise = false) => {
    if (revise && draft.trim()) {
      setError('Send or clear your draft before revising.')
      composer.current?.focus()
      return
    }
    setReplyTo(message)
    setPracticeTargetId(message.id)
    if (revise) setDraft(message.text)
    composer.current?.focus()
  }

  const saveSentence = (message: GroupMessage, meaning: string) => {
    if (!message.sender || !meaning.trim()) return
    const result = onReceiveWord({
      id: `sentence-${message.id}`,
      card: { prompt: message.text, meaning: meaning.trim(), example: message.text, translation: meaning.trim(), category: 'phrase' },
      note: '', sender: message.sender, createdAt: message.createdAt,
    })
    if (!result) return
    if (result === 'already-present') onNotify('That sentence is already in your deck.')
    setSavingSentence(null)
  }

  const submitEdit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || !editing.text.trim()) return
    void run(async () => {
      const data = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages/${editing.messageId}/edit`, { text: editing.text })
      if (!data.message?.id) throw new Error('The group service returned an incomplete response.')
      setMessages((current) => mergeMessages(current, [data.message]))
      setEditing(null)
      await reload()
    })
  }

  const submitReview = (messageId: string, review: { approve: true } | { text: string; note?: string; tags?: string[] }) => {
    void run(async () => {
      const data = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages/${messageId}/reviews`, review)
      if (!data.message?.id) throw new Error('The group service returned an incomplete response.')
      setMessages((current) => mergeMessages(current, [data.message]))
      setCorrecting(null)
      onNotify('Review shared with the group.')
    })
  }

  const respondToReview = async (message: GroupMessage, review: GroupReview, response: 'thanks' | 'saved') => {
    const data = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages/${message.id}/reviews/${review.authorId}/respond`, { response })
    if (!data.message?.id) throw new Error('The group service returned an incomplete response.')
    setMessages((current) => mergeMessages(current, [data.message]))
  }

  const saveReview = (message: GroupMessage, review: GroupReview, meaning: string) => {
    if (!review.text || !meaning.trim()) return
    const result = onReceiveWord({
      id: `correction-${message.id}-${review.authorId}`,
      card: { prompt: review.text, meaning: meaning.trim(), example: review.text, translation: meaning.trim(), category: 'phrase' },
      note: review.note ?? '', sender: review.author ?? { id: review.authorId, username: 'Former member', avatarSeed: '' }, createdAt: review.createdAt,
    })
    if (!result) return
    if (result === 'already-present') onNotify('That sentence is already in your deck.')
    void run(async () => { await respondToReview(message, review, 'saved'); setSavingCorrection(null) })
  }

  const removeReviewFromSearch = (messageId: string, authorId: string) => {
    setSearchState((current) => current && {
      ...current,
      messages: current.messages.flatMap((item) => {
        if (item.id !== messageId) return [item]
        const corrections = item.corrections?.filter((review) => review.authorId !== authorId)
        const updated = { ...item, corrections }
        return matchSnippet(updated, current.query) || corrections?.some((correction) => matchSnippet({ ...updated, text: '', card: undefined, correction }, current.query)) ? [updated] : []
      }),
    })
  }

  const hideReview = async (message: GroupMessage, review: GroupReview) => {
    const confirmed = await confirmDialog({ title: 'Hide this review?', message: 'It will be hidden from everyone in the group.', confirmLabel: 'Hide review', tone: 'danger' })
    if (!confirmed) return
    await run(async () => {
      await groupsRequest(`/${group.id}/messages/${message.id}/reviews/${review.authorId}/hide`, {})
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, corrections: item.corrections?.filter((entry) => entry.authorId !== review.authorId) } : item))
      removeReviewFromSearch(message.id, review.authorId)
    })
  }

  const submitReport = async (report: { messageId: string; authorId?: string }, reason: ReportReason, details: string) => {
    if (report.authorId) {
      const data = await groupsRequest<{ hidden: boolean }>(`/${group.id}/messages/${report.messageId}/reviews/${report.authorId}/report`, { reason, ...(details ? { details } : {}) })
      setMessages((current) => current.map((item) => item.id !== report.messageId ? item : {
        ...item, corrections: item.corrections?.flatMap((review) => review.authorId !== report.authorId ? [review] : data.hidden ? [] : [{ ...review, reported: true }]),
      }))
      if (data.hidden) removeReviewFromSearch(report.messageId, report.authorId)
    } else {
      const data = await groupsRequest<{ hidden: boolean }>(`/${group.id}/messages/${report.messageId}/report`, { reason, ...(details ? { details } : {}) })
      if (data.hidden) redactLoadedMessage(report.messageId, 'hidden')
      else setMessages((current) => current.map((item) => item.id === report.messageId ? { ...item, reported: true } : item))
    }
    onNotify('Thanks. Your report was recorded.')
  }

  const shareWord = (card: Card) => {
    void run(async () => {
      const data = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages`, {
        card: cardPayload(card), ...(replyTo ? { replyToId: replyTo.id } : {}),
      })
      if (!data.message?.id) throw new Error('The group service returned an incomplete response.')
      stickToBottom.current = true
      setMessages((current) => mergeMessages(current, [data.message]))
      setReplyTo(null)
      setWordPickerQuery('')
      if (wordPicker.current) wordPicker.current.open = false
      await load()
    })
  }

  const addWord = (message: GroupMessage) => {
    if (!message.card) return
    const result = onReceiveWord({
      id: message.id, card: message.card, note: '',
      sender: message.sender ?? { id: '', username: 'Former member', avatarSeed: '' }, createdAt: message.createdAt,
    })
    if (result === 'already-present') onNotify(`You already had ${message.card.prompt} in your deck.`)
  }

  const redactLoadedMessage = (id: string, kind: 'hidden' | 'unsent') => {
    const text = kind === 'hidden' ? 'Hidden by a moderator' : 'Message unsent'
    setMessages((current) => current.map((item) => item.id === id
      ? { ...item, kind, text, card: undefined, replyTo: undefined, reactions: [] }
      : item.replyTo?.id === id ? { ...item, replyTo: { ...item.replyTo, text } } : item))
    setSearchState((current) => current && { ...current, messages: current.messages.filter((item) => item.id !== id) })
    setReplyTo((current) => current?.id === id ? null : current)
  }

  const unsend = async (message: GroupMessage) => {
    const ok = await confirmDialog({ title: 'Unsend this message?', message: 'It is replaced with “Message unsent” for everyone in the group.', confirmLabel: 'Unsend', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/messages/${message.id}/unsend`, {})
      redactLoadedMessage(message.id, 'unsent')
      await load()
    })
  }

  const hide = async (message: GroupMessage) => {
    const ok = await confirmDialog({ title: 'Hide this message?', message: `${message.sender?.username ?? 'The author'}’s message is hidden from everyone in the group. This cannot be undone.`, confirmLabel: 'Hide message', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/messages/${message.id}/hide`, {})
      redactLoadedMessage(message.id, 'hidden')
      await load()
    })
  }

  const toggleMembers = () => {
    const next = !membersOpen
    setMembersOpen(next)
    if (!next) return
    void groupsRequest<{ members: (Profile & { role: string })[]; canRemove: boolean }>(`/${group.id}/members`)
      .then((data) => setMembers({ list: data.members, canRemove: data.canRemove }))
      .catch((failure: unknown) => setError(errorMessage(failure, 'Could not load members.')))
  }

  const loadMentions = async (older = false) => {
    setMentionsLoading(true)
    setError(null)
    try {
      const cursor = older ? mentions?.cursor : null
      if (older && !cursor) throw new Error('Could not find the next mentions page.')
      const query = cursor ? `?before=${encodeURIComponent(cursor.createdAt)}&beforeId=${encodeURIComponent(cursor.id)}` : ''
      const data = await groupsRequest<{ messages: GroupMessage[]; hasMore: boolean }>(`/${group.id}/mentions${query}`)
      if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') throw new Error('The group service returned an incomplete mention list.')
      setMentions((current) => ({
        messages: older ? [...(current?.messages ?? []), ...data.messages] : data.messages,
        hasMore: data.hasMore,
        cursor: data.messages.at(-1) ?? null,
      }))
    } catch (failure) {
      setError(errorMessage(failure, 'Could not load mentions.'))
    } finally {
      setMentionsLoading(false)
    }
  }

  const clearMention = (message: GroupMessage) => run(async () => {
    await groupsRequest(`/${group.id}/mentions/${message.id}/clear`, {})
    setMentions((current) => current && { ...current, messages: current.messages.filter((item) => item.id !== message.id) })
    await reload()
  })

  const removeMember = async (member: Profile) => {
    const ok = await confirmDialog({ title: `Remove ${member.username}?`, message: 'They leave the group and cannot join it again.', confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/members/remove`, { id: member.id })
      setMembers((current) => current && { ...current, list: current.list.filter((item) => item.id !== member.id) })
      await reload()
    })
  }

  const setState = async (state: 'open' | 'closed') => {
    if (state === 'closed') {
      const ok = await confirmDialog({ title: 'Close this group?', message: 'Members stay and can keep talking, but nobody new can join until you open it again.', confirmLabel: 'Close group' })
      if (!ok) return
    }
    await run(async () => {
      await groupsRequest(`/${group.id}/state`, { state })
      await reload()
    })
  }

  const setVisibility = (visibility: GroupSummary['visibility']) => run(async () => {
    await groupsRequest(`/${group.id}/visibility`, { visibility })
    await reload()
    onNotify(visibility === 'unlisted' ? 'Group hidden from Discover.' : 'Group visible in Discover.')
  })

  const copyInvitation = () => run(async () => {
    const data = await groupsRequest<{ inviteToken: string }>(`/${group.id}/invitation`)
    if (!data.inviteToken) throw new Error('The group service returned an incomplete invitation.')
    const url = new URL(window.location.pathname, window.location.origin)
    url.hash = new URLSearchParams({ groupInvite: data.inviteToken }).toString()
    if (!navigator.clipboard?.writeText) throw new Error('Copying is not available in this browser.')
    await navigator.clipboard.writeText(url.toString())
    onNotify('Invitation copied. Anyone with the link can join while the group is open.')
  })

  const openInfo = () => {
    setPopover('info')
    setMessageCount(null)
    setInfoError(null)
    void groupsRequest<{ messageCount: number }>(`/${group.id}/info`)
      .then((data) => setMessageCount(data.messageCount))
      .catch((failure: unknown) => setInfoError(errorMessage(failure, 'Could not load group information.')))
  }

  const openEditor = () => {
    setNewName(group.name)
    setNewDescription(group.description)
    setError(null)
    setPopover('edit')
  }

  const closeGroupPopover = () => {
    setPopover(null)
    groupNameRef.current?.focus()
  }

  const saveDetails = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateRename(event.currentTarget)) return
    const name = newName.trim().replace(/\s+/g, ' ')
    const description = newDescription.trim()
    if (name === group.name && description === group.description) {
      closeGroupPopover()
      return
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: 'Change group details?',
        message: name !== group.name
          ? `The group will be called “${name}” and members will see a notice in the chat.`
          : 'The updated description will be visible to learners browsing the group.',
        confirmLabel: 'Save changes',
      })
      if (!confirmed) return
      await run(async () => {
        await groupsRequest(`/${group.id}/details`, { name, description })
        closeGroupPopover()
        await reload()
        await load()
      })
    })()
  }

  const deleteGroup = async () => {
    const ok = await confirmDialog({ title: `Delete ${group.name}?`, message: 'All messages and members are removed for everyone. This cannot be undone.', confirmLabel: 'Delete group', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/delete`, {})
      cache.delete(group.id)
      onClose()
      await reload()
    })
  }

  const leave = async () => {
    if (group.state === 'closed') {
      const ok = await confirmDialog({ title: `Leave ${group.name}?`, message: 'This group is closed, so you cannot join it again.', confirmLabel: 'Leave group', tone: 'danger' })
      if (!ok) return
    }
    await run(async () => {
      await groupsRequest(`/${group.id}/leave`, {})
      cache.delete(group.id)
      onClose()
      await reload()
    })
  }

  const jumpTo = (id: string) => {
    const target = document.getElementById(`group-message-${id}`)
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  const showSearchResult = async (result: GroupMessage) => {
    let loadedMessages = messages
    let fetchedMessages: GroupMessage[] = []
    let found = loadedMessages.some((message) => message.id === result.id && (message.kind === 'text' || message.kind === 'word'))
    let hasMore = hasOlder
    const operation = beginOlderMessages()
    setLoadingOlder(true)
    setError(null)
    let problem: unknown = null
    try {
      const current = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages/${result.id}`)
      if (!current.message?.id) throw new Error('The group service returned an incomplete response.')
      if (current.message.kind !== 'text' && current.message.kind !== 'word') {
        setMessages((items) => items.map((item) => item.id === current.message.id ? current.message : item))
        setSearchState((state) => state && { ...state, messages: state.messages.filter((item) => item.id !== result.id) })
        problem = new Error('That message is no longer available.')
        return
      }
      for (let page = 0; !found && hasMore && page < 42; page += 1) {
        const oldest = loadedMessages[0]
        if (!oldest) break
        const data = await groupsRequest<{ messages: GroupMessage[]; hasMore: boolean }>(
          `/${group.id}/messages?before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}`,
        )
        if (!Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') throw new Error('The group service returned an incomplete response.')
        if (!data.messages.length) break
        loadedMessages = mergeMessages(loadedMessages, data.messages)
        fetchedMessages = mergeMessages(fetchedMessages, data.messages)
        hasMore = data.hasMore
        found = data.messages.some((message) => message.id === result.id && (message.kind === 'text' || message.kind === 'word'))
        if (data.messages.some((message) => message.id === result.id && message.kind !== 'text' && message.kind !== 'word')) break
      }
      setMessages((items) => mergeMessages(items, [...fetchedMessages, current.message]))
      setHasOlder(hasMore)
      if (!found) {
        problem = new Error('That message is no longer available or is too far back to show.')
        return
      }
      setSearchOpen(false)
      setMentionsOpen(false)
      setHighlightId(result.id)
      window.setTimeout(() => jumpTo(result.id), 60)
      window.setTimeout(() => setHighlightId((current) => current === result.id ? null : current), 2600)
    } catch (failure) {
      problem = failure
    } finally {
      await finishOlderMessages(operation)
      if (problem) setError(errorMessage(problem, 'Could not load earlier messages.'))
      setLoadingOlder(false)
    }
  }

  if (unavailable) return <p className="companion-alert" role="alert">{error ?? 'This group is unavailable.'}</p>

  return <>
    <header className="companion-chat-header">
      <span className="group-avatar" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase()}</span>
      <div className="companion-chat-identity">
        <h2><button ref={groupNameRef} className="group-name-trigger" type="button" aria-haspopup="dialog" aria-expanded={Boolean(popover)} aria-controls={popover ? popoverId : undefined} onClick={() => popover ? setPopover(null) : openInfo()}>{group.name}</button></h2>
        <span className={`companion-status-tag ${group.state === 'open' ? 'connected' : 'outgoing'}`}>{group.state === 'open' ? 'Open' : 'Closed'}</span>
      </div>
      <div className="companion-chat-header-actions">
        <button className="companion-header-pill" type="button" aria-label="Search this group" aria-pressed={searchOpen} disabled={updating} onClick={() => { setSearchOpen((open) => !open); setSearchError(null) }}><Search size={14} aria-hidden="true" /><span>Search</span></button>
        <button className="companion-header-pill group-mentions-toggle" type="button" aria-pressed={mentionsOpen} aria-label={`Mentions, ${group.mentionCount ?? 0} pending`} onClick={() => { const next = !mentionsOpen; setMentionsOpen(next); if (next) void loadMentions() }}><AtSign size={14} aria-hidden="true" /><span>{group.mentionCount ?? 0}</span>{Boolean(group.mentionCount) && <b className="group-mentions-badge" aria-hidden="true">{group.mentionCount && group.mentionCount > 99 ? '99+' : group.mentionCount}</b>}</button>
        <button className="companion-header-pill" type="button" aria-pressed={membersOpen} onClick={toggleMembers}><Users size={14} aria-hidden="true" /><span>{group.memberCount}</span></button>
        <details className="companion-row-menu companion-chat-menu" onToggle={onChatDetailsToggle}>
          <summary className="companion-header-pill" aria-label="Group actions"><Ellipsis size={15} aria-hidden="true" /><span>More</span></summary>
          <div className="companion-row-popover">
            {(group.isOwner || canModerate) && <button type="button" onClick={(event) => { closePopover(event); openEditor() }}>Edit group details</button>}
            {(group.isOwner || canModerate) && <button type="button" onClick={(event) => { closePopover(event); void setState(group.state === 'open' ? 'closed' : 'open') }}>{group.state === 'open' ? 'Close to new members' : 'Open to new members'}</button>}
            {(group.isOwner || canModerate) && <button type="button" disabled={busy} onClick={(event) => { closePopover(event); void setVisibility(group.visibility === 'unlisted' ? 'listed' : 'unlisted') }}>{group.visibility === 'unlisted' ? 'Show in Discover' : 'Hide from Discover'}</button>}
            {group.visibility === 'unlisted' && <button type="button" disabled={busy} onClick={(event) => { closePopover(event); void copyInvitation() }}>Copy invitation link</button>}
            {(group.isOwner || canModerate) && <button className="danger" type="button" onClick={(event) => { closePopover(event); void deleteGroup() }}>Delete group</button>}
            {!group.isOwner && <button className="danger" type="button" onClick={(event) => { closePopover(event); void leave() }}>Leave group</button>}
          </div>
        </details>
      </div>
    </header>
    {popover && <FloatingPopover anchorRef={groupNameRef} popoverRef={popoverRef} owner={popoverId} preferredWidth={300} preferredMaxHeight={640}
      id={popoverId} className="group-details-popover" role="dialog" tabIndex={-1} aria-label={popover === 'info' ? 'Group information' : 'Edit group details'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeGroupPopover() }
      }}>
      {popover === 'info' ? <>
        <div className="group-popover-heading"><strong>{group.name}</strong></div>
        <p className="group-info-description">{group.description || 'No description yet.'}</p>
        <dl className="group-info-stats">
          <div><dt>Messages</dt><dd>{infoError ? 'Unavailable' : messageCount ?? '…'}</dd></div>
          <div><dt>Members</dt><dd>{group.memberCount}</dd></div>
          <div><dt>Created</dt><dd>{new Date(group.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd></div>
        </dl>
        {infoError && <p className="companion-alert" role="alert">{infoError}</p>}
        {(group.isOwner || canModerate) && <button className="group-edit-details" type="button" onClick={openEditor}>Edit group details</button>}
      </> : <form className="group-rename-form" noValidate onInput={handleRenameInput} onSubmit={saveDetails}>
        <div className="group-popover-heading"><strong>Edit group details</strong></div>
        <label className="companion-field">Group name
          <input name="name" value={newName} onChange={(event) => setNewName(event.target.value)} minLength={3} maxLength={40} required aria-invalid={Boolean(renameErrors.name) || undefined} aria-describedby={renameErrors.name ? 'group-rename-error' : undefined} autoFocus />
          {renameErrors.name && <span className="field-error" id="group-rename-error">{renameErrors.name}</span>}
        </label>
        <label className="companion-field">Description
          <textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={200} rows={3} />
          <small>{newDescription.length}/200</small>
        </label>
        {error && <p className="companion-alert" role="alert">{error}</p>}
        <div className="companion-card-actions">
          <button type="submit" disabled={busy}>Save changes</button>
          <button type="button" disabled={busy} onClick={closeGroupPopover}>Cancel</button>
        </div>
      </form>}
    </FloatingPopover>}
    {searchOpen && <div className="companion-search-panel">
      <div className="companion-message-search">
        <Search size={14} aria-hidden="true" />
        <input value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); setSearchError(null) }} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Search words or phrases" aria-label="Search this group" maxLength={100} autoFocus />
        {searchQuery && <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')}><X size={13} aria-hidden="true" /></button>}
      </div>
      {searchError ? <p className="companion-alert" role="alert">{searchError}</p> : searchTerm.length >= 2 && (
        searchState?.query === searchTerm
          ? searchState.messages.length
            ? <>
              <ul className="companion-search-results">
                {searchState.messages.map((result) => {
                  const snippet = matchSnippet(result, searchTerm) ?? result.corrections?.map((correction) => matchSnippet({ ...result, text: '', card: undefined, correction }, searchTerm)).find(Boolean)
                  return <li key={result.id}><button type="button" disabled={loadingOlder} onClick={() => void showSearchResult(result)}>
                    <span><strong>{result.isMine ? 'You' : result.sender?.username ?? 'Former member'}</strong><time dateTime={result.createdAt}>{formatTime(result.createdAt)}</time></span>
                    <span>{snippet ? <>{snippet.before}<mark>{snippet.match}</mark>{snippet.after}</> : result.text}</span>
                  </button></li>
                })}
              </ul>
              {searchState.hasMore && <p className="companion-search-note">Showing the 30 most recent matches.</p>}
            </>
            : <p className="companion-search-note">No messages match “{searchTerm}”.</p>
          : <p className="companion-search-note" role="status">Searching…</p>
      )}
      <p className="companion-search-note">Searches the latest 1,000 group messages.</p>
    </div>}
    {mentionsOpen && <div className="companion-search-panel group-mentions" aria-label="Your mentions">
      <div className="group-mentions-heading"><strong>Your mentions</strong><button type="button" className="group-mentions-action" disabled={mentionsLoading} onClick={() => void loadMentions()}>Refresh</button></div>
      {mentionsLoading && !mentions ? <p className="companion-search-note" role="status">Loading mentions…</p>
        : !mentions ? <p className="companion-search-note">Mentions are unavailable. Try Refresh.</p>
        : !mentions?.messages.length ? <p className="companion-search-note">No mentions to show.</p>
        : <ul>{mentions.messages.map((message) => <li key={message.id}>
          <button type="button" className="group-mention-message" disabled={loadingOlder} onClick={() => void showSearchResult(message)}>
            <strong>{message.sender?.username ?? 'Former member'}</strong> <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            <span>{message.text}</span>
          </button>
          <button type="button" className="group-mentions-action" disabled={busy} onClick={() => void clearMention(message)}>Clear</button>
        </li>)}</ul>}
      {mentions?.hasMore && <button type="button" className="group-mentions-action group-mentions-more" disabled={mentionsLoading} onClick={() => void loadMentions(true)}>{mentionsLoading ? 'Loading…' : 'Load earlier mentions'}</button>}
    </div>}
    {membersOpen && <div className="companion-search-panel group-members">
      {group.description && <p className="group-description">{group.description}</p>}
      {!members ? <p className="companion-search-note">Loading members…</p> : <ul>
        {members.list.map((member) => <li key={member.id}>
          <img src={avatarDataUri(member.avatarSeed)} alt="" />
          <span>{member.username}{member.role === 'owner' && <em>Owner</em>}</span>
          {members.canRemove && member.role !== 'owner' && <button type="button" disabled={busy} onClick={() => void removeMember(member)}>Remove</button>}
        </li>)}
      </ul>}
    </div>}
    <aside className="companion-practice-nudge group-rules-note" aria-label="Group reminder">
      <p>Everyone in this group can read what you write. Be kind, stay on topic, and report anything that is not.</p>
    </aside>
    {error && <p className="companion-alert" role="alert">{error}</p>}
    <div className="companion-chat-stream" ref={stream} role="log" aria-label={`Messages in ${group.name}`} aria-live="polite" aria-busy={updating}>
      <ChatMessageList updating={updating}>
      {hasOlder && <button className="companion-load-older" type="button" disabled={loadingOlder || updating} onClick={loadOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
      {!loaded ? <p className="companion-empty-note">Loading messages…</p> : messages.length === 0 && pendingMessages.length === 0 && !updating && !error
        ? <div className="companion-chat-empty"><img className="companion-welcome-logo" src="/app-icon.svg" alt="" /><p>Say hello to the group.</p><span>Ask a question, share a tip, or welcome someone new.</span></div>
        : messages.map((message) => message.kind === 'system'
          ? <p className="group-system-message" key={message.id}>{message.text}</p>
          : <article className={`companion-message-row group-message${highlightId === message.id ? ' highlighted' : ''}`} id={`group-message-${message.id}`} key={message.id}>
          <div className="companion-message-content">
            {message.replyTo && (message.kind === 'text' || message.kind === 'word') && <button className="companion-reply-quote" style={replyColor(message.replyTo.id)} type="button" onClick={() => jumpTo(message.replyTo!.id)}>
              <strong>{message.replyTo.isMine ? 'You' : 'Replying to a message'}</strong><span>{message.replyTo.text}</span>
            </button>}
            <div className="companion-message-meta">
              {message.sender && <img className="group-message-avatar" src={avatarDataUri(message.sender.avatarSeed)} alt="" />}
              <strong>{message.isMine ? 'You' : message.sender?.username ?? 'Former member'}</strong>
              <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
              {message.isMine && (message.kind === 'text' || message.kind === 'word') && <MessageReceipt status={message.receipt ?? 'sent'} />}
              {message.editedAt && <span className="companion-edited">edited</span>}
            </div>
            {(message.hasLinks || ((message.kind === 'text' || message.kind === 'word') && /https?:\/\/|www\./i.test([message.text, ...Object.values(message.card ?? {})].join(' ')))) && <p className="group-safety-notice"><ShieldAlert size={14} aria-hidden="true" />External link. Check the destination before opening.</p>}
            {message.kind === 'word' && message.card
              ? <div className="companion-word-card">
                <span className="companion-word-card-label">Shared a word <em>{message.card.category}</em></span>
                <p className="companion-word-card-prompt" lang="de">{message.card.prompt}</p>
                {message.card.plural && <small>Plural: <span lang="de">{message.card.plural}</span></small>}
                <p className="companion-word-card-meaning">{message.card.meaning}</p>
                <p className="companion-word-card-example" lang="de">{message.card.example}</p>
                {message.card.translation && <p className="companion-word-card-translation">{message.card.translation}</p>}
                <div className="group-word-actions"><button className="group-use-word" type="button" onClick={() => startWordPractice(message)}>Use this word</button>
                {!message.isMine && (cardInDeck(message.card, message.id) ? <span className="companion-word-card-status">In your deck</span> : <button className="companion-word-card-add" type="button" onClick={() => addWord(message)}>Add to deck</button>)}</div>
              </div>
              : message.kind === 'text' && editing?.messageId === message.id
              ? <form className="companion-edit-form" onSubmit={submitEdit}>
                <textarea rows={2} maxLength={message.wordPractice ? 500 : 1000} value={editing.text} autoFocus aria-label="Edit your message" onChange={(event) => setEditing({ ...editing, text: event.target.value })} onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) }
                  else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
                }} />
                <div className="companion-card-actions">
                  <button type="submit" disabled={busy || !editing.text.trim() || editing.text.trim() === message.text}>Save</button>
                  <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
              : message.kind === 'text'
              ? <>{message.wordPractice && <span className="group-practice-tag">Sentence practice</span>}<MessageWords id={message.id} text={message.text} tools={wordTools} /></>
              : <p className={message.kind === 'hidden' ? 'group-safety-notice' : 'companion-message-unsent'}>{message.kind === 'hidden' && <ShieldAlert size={14} aria-hidden="true" />}{message.text}</p>}
            {message.heldReview && <p className="group-safety-notice"><ShieldAlert size={14} aria-hidden="true" />A suggestion is hidden pending language review.</p>}
            {message.kind === 'hidden' && message.isMine && <div className="companion-message-tools"><button className="companion-review-pill" type="button" disabled={busy} onClick={() => void unsend(message)}>Unsend</button></div>}
            {message.kind === 'text' && message.wordPractice && message.isMine && <div className="group-sentence-actions">
              <button className="companion-review-pill" type="button" onClick={() => startWordPractice(message, true)}>Revise</button>
              {savingSentence?.messageId === message.id
                ? <form className="companion-correction-save" onSubmit={(event) => { event.preventDefault(); saveSentence(message, savingSentence.meaning) }}>
                  <label>English meaning<input value={savingSentence.meaning} maxLength={200} required onChange={(event) => setSavingSentence({ ...savingSentence, meaning: event.target.value })} autoFocus /></label>
                  <button type="submit" disabled={!savingSentence.meaning.trim()}>Save</button>
                  <button type="button" onClick={() => setSavingSentence(null)}>Cancel</button>
                </form>
                : <button className="companion-review-pill" type="button" onClick={() => setSavingSentence({ messageId: message.id, meaning: '' })}>Save sentence</button>}
            </div>}
            {message.kind === 'text' && correcting?.messageId === message.id && <form className="companion-correction-form" onSubmit={(event) => {
              event.preventDefault()
              if (!correcting.text.trim()) return
              submitReview(message.id, { text: correcting.text, ...(correcting.note.trim() ? { note: correcting.note } : {}), ...(correcting.tags.length ? { tags: correcting.tags } : {}) })
            }}>
              <label>Suggested sentence
                <textarea lang="de" rows={2} maxLength={1000} value={correcting.text} onChange={(event) => setCorrecting({ ...correcting, text: event.target.value })} autoFocus />
              </label>
              {correcting.text.trim() && correcting.text.trim() !== message.text && <div className="companion-correction-preview" aria-label="Preview of your suggestion"><CorrectionDiff original={message.text} corrected={correcting.text.trim()} /></div>}
              <div className="companion-correction-tags" role="group" aria-label="What changed (optional, up to 3)">
                {Object.entries(correctionTagLabels).map(([tag, label]) => <button key={tag} type="button" aria-pressed={correcting.tags.includes(tag)} disabled={!correcting.tags.includes(tag) && correcting.tags.length >= 3} onClick={() => setCorrecting({ ...correcting, tags: correcting.tags.includes(tag) ? correcting.tags.filter((item) => item !== tag) : [...correcting.tags, tag] })}>{label}</button>)}
              </div>
              <label>Short note (optional)<input maxLength={200} value={correcting.note} onChange={(event) => setCorrecting({ ...correcting, note: event.target.value })} placeholder="e.g. The verb goes in second position" /></label>
              <p>Be kind and specific: say what to revisit and why.</p>
              <div className="companion-card-actions">
                <button type="submit" disabled={busy || !correcting.text.trim() || correcting.text.trim() === message.text}>Send suggestion</button>
                <button type="button" disabled={busy} onClick={() => setCorrecting(null)}>Cancel</button>
              </div>
            </form>}
            {message.kind === 'text' && message.corrections?.map((review) => <div className="companion-correction" key={review.authorId}>
              {(review.hasLinks || /https?:\/\/|www\./i.test([review.text, review.note].filter(Boolean).join(' '))) && <p className="group-safety-notice">External link. Check the destination before opening.</p>}
              <span className="companion-correction-label">{review.approved ? <><Check size={12} aria-hidden="true" /> Looks good</> : 'Suggested rewrite'} · {review.byMe ? 'by you' : `by ${review.author?.username ?? 'Former member'}`}</span>
              {review.text && <CorrectionDiff original={message.text} corrected={review.text} />}
              {!!review.tags?.length && <div className="companion-correction-tags static">{review.tags.map((tag) => <span key={tag}>{correctionTagLabels[tag] ?? tag}</span>)}</div>}
              {review.note && <p className="companion-correction-note">{review.note}</p>}
              {message.isMine && (review.response === 'saved' ? <span className="companion-correction-status">Saved to your deck</span>
                : savingCorrection?.messageId === message.id && savingCorrection.authorId === review.authorId
                  ? <form className="companion-correction-save" onSubmit={(event) => { event.preventDefault(); saveReview(message, review, savingCorrection.meaning) }}>
                    <input value={savingCorrection.meaning} maxLength={200} onChange={(event) => setSavingCorrection({ ...savingCorrection, meaning: event.target.value })} placeholder="What does it mean? (English)" aria-label="English meaning" autoFocus />
                    <button type="submit" disabled={busy || !savingCorrection.meaning.trim()}>Save</button>
                    <button type="button" onClick={() => setSavingCorrection(null)}>Cancel</button>
                  </form>
                  : <div className="companion-correction-actions">
                    {review.response === 'thanks' ? <span className="companion-correction-status">You said thanks</span> : <button type="button" disabled={busy} onClick={() => void run(() => respondToReview(message, review, 'thanks'))}>Thanks</button>}
                    {!review.approved && <button type="button" disabled={busy} onClick={() => setSavingCorrection({ messageId: message.id, authorId: review.authorId, meaning: '' })}>Add to my deck</button>}
                  </div>)}
              {!message.isMine && review.byMe && review.response && <span className="companion-correction-status">{review.response === 'saved' ? 'They saved it to their deck' : 'They said thanks'}</span>}
              <div className="companion-correction-actions">
                {!review.byMe && (review.reported ? <span>Reported</span> : <button type="button" onClick={(event) => { reportAnchor.current = event.currentTarget; setReporting({ messageId: message.id, authorId: review.authorId }) }}>Report review</button>)}
                {message.canHide && <button type="button" disabled={busy} onClick={() => void hideReview(message, review)}>Hide review</button>}
              </div>
            </div>)}
            {(message.kind === 'text' || message.kind === 'word') && <div className="companion-message-tools">
              {(message.reactions ?? []).map((reaction) => <button className={`companion-reaction${reaction.mine ? ' mine' : ''}`} key={reaction.emoji} type="button" aria-pressed={reaction.mine} aria-label={`${reaction.emoji} ${reaction.count}`} onClick={() => toggleReaction(message, reaction.emoji)}><span aria-hidden="true">{reaction.emoji}</span>{reaction.count}</button>)}
              {reactionPickerFor === message.id
                ? <span className="companion-reaction-picker" role="group" aria-label="Choose a reaction">{reactionOptions.map((emoji) => <button key={emoji} type="button" aria-label={`React with ${emoji}`} onClick={() => toggleReaction(message, emoji)}>{emoji}</button>)}</span>
                : <button className="companion-tool-button" type="button" aria-label="Add reaction" onClick={() => setReactionPickerFor(message.id)}><SmilePlus size={15} aria-hidden="true" /></button>}
              <button className="companion-tool-button" type="button" aria-label={`Reply to ${message.isMine ? 'your message' : message.sender?.username ?? 'this message'}`} onClick={() => { setReplyTo(message); setPracticeTargetId(null); composer.current?.focus() }}><Reply size={15} aria-hidden="true" /></button>
              {message.kind === 'text' && <button className="companion-tool-button" type="button" aria-label="Look up words in this message" aria-pressed={wordTools.wordChipsFor === message.id} title="Look up words" onClick={() => wordTools.toggleChips(message.id)}><Languages size={15} aria-hidden="true" /></button>}
              {!message.isMine && message.kind === 'text' && !message.reviewedByMe && correcting?.messageId !== message.id && <>
                <button className="companion-review-pill" type="button" disabled={busy} onClick={() => setCorrecting({ messageId: message.id, text: message.text, note: '', tags: [] })}><SpellCheck size={13} aria-hidden="true" /><span>Suggest edit</span></button>
                <button className="companion-review-pill" type="button" disabled={busy} onClick={() => submitReview(message.id, { approve: true })}><Check size={13} aria-hidden="true" /><span>Looks good</span></button>
              </>}
              <MessageActionMenu label={message.isMine ? 'Actions for your message' : `Actions for message from ${message.sender?.username ?? 'a member'}`} open={messageMenu === message.id} onOpenChange={(open) => setMessageMenu(open ? message.id : null)} actions={[
                ...(message.isMine && message.kind === 'text' && !message.hasReviews && message.editableUntil && Date.parse(message.editableUntil) > now ? [{ label: 'Edit message', onSelect: () => setEditing({ messageId: message.id, text: message.text }) }] : []),
                ...(message.isMine ? [{ label: 'Unsend', danger: true, disabled: busy, onSelect: () => void unsend(message) }] : []),
                ...(!message.isMine ? [{ label: message.reported ? 'Reported' : 'Report message', disabled: busy || message.reported, onSelect: (anchor: HTMLButtonElement) => { reportAnchor.current = anchor; setReporting({ messageId: message.id }) } }] : []),
                ...(message.canHide && !message.isMine ? [{ label: 'Hide message', danger: true, disabled: busy, onSelect: () => void hide(message) }] : []),
              ]} />
            </div>}
          </div>
        </article>)}
      </ChatMessageList>
      <PendingChatMessages items={pendingMessages} outbox={outbox} />
      {awayFromBottom && <button className="companion-scroll-bottom" type="button" aria-label="Scroll to latest messages" onClick={() => {
        const element = stream.current
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      }}><ChevronDown size={18} aria-hidden="true" /></button>}
    </div>
    {typing.length > 0 && <div className="companion-chat-statuses">
      {typing.length > 0 && <p className="companion-chat-status typing" role="status">{typing.slice(0, 3).map((person) => person.username).join(', ')}{typing.length > 3 ? ` and ${typing.length - 3} more` : ''} {typing.length === 1 ? 'is' : 'are'} typing…</p>}
    </div>}
    <form className="companion-chat-composer" onSubmit={send}>
      <label className="companion-visually-hidden" htmlFor="group-message">{usingWord ? 'Practice sentence in German' : `Message ${group.name}`}</label>
      {replyTo && <div className="companion-reply-bar" style={replyColor(replyTo.id)}>
        <span>{usingWord ? (replyTo.card ? 'Use this word' : 'Revise your sentence') : <>Replying to <strong>{replyTo.isMine ? 'yourself' : replyTo.sender?.username ?? 'a member'}</strong></>}<em>{replyTo.card?.prompt ?? replyTo.text}</em></span>
        <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={14} aria-hidden="true" /></button>
      </div>}
      <div className="companion-composer-input">
        <textarea ref={composer} id="group-message" rows={1} maxLength={usingWord ? 500 : 1000} value={draft} onChange={(event) => { setDraft(event.target.value); publishTyping(group.id, Boolean(event.target.value.trim())) }} onBlur={() => publishTyping(group.id, false)} onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
        }} placeholder={usingWord ? 'Write a sentence in German…' : 'Write to the group…'} />
        <button className="companion-send-button" type="submit" disabled={!draft.trim()}>Send</button>
      </div>
      {mentionQuery !== undefined && members && <div className="group-mention-suggestions" role="group" aria-label="Mention a group member">
        {members.list.filter((member) => member.username.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 8).map((member) =>
          <button key={member.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
            setDraft((current) => current.replace(/@([A-Za-z0-9_-]{0,20})$/, `@${member.username} `))
            composer.current?.focus()
          }}>@{member.username}</button>)}
      </div>}
      <div className="companion-composer-footer">
        <details className="companion-word-picker" ref={wordPicker} onToggle={onChatDetailsToggle}>
          <summary><BookOpen size={13} aria-hidden="true" /><span>Share a word</span></summary>
          <div className="companion-word-picker-panel">
            <input value={wordPickerQuery} onChange={(event) => setWordPickerQuery(event.target.value)} placeholder="Search your words…" aria-label="Search your words" />
            <div className="companion-word-picker-results" role="group" aria-label="Words to share in this group">
              {shareableCards.filter((card) => !wordPickerQuery.trim() || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(wordPickerQuery.trim().toLocaleLowerCase())).sort((a, b) => Date.parse(b.lastReviewedAt ?? b.createdAt) - Date.parse(a.lastReviewedAt ?? a.createdAt)).slice(0, 8).map((card) => <button key={card.id} type="button" disabled={busy} onClick={() => shareWord(card)}><strong lang="de">{card.prompt}</strong><span>{card.meaning}</span></button>)}
              {!shareableCards.some((card) => !wordPickerQuery.trim() || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(wordPickerQuery.trim().toLocaleLowerCase())) && <p className="companion-empty-note">No matching shareable words.</p>}
            </div>
          </div>
        </details>
        <span>{draft.length}/{usingWord ? 500 : 1000}</span>
      </div>
    </form>
    {reporting && <ReportPopover key={`${reporting.messageId}-${reporting.authorId ?? 'message'}`} anchorRef={reportAnchor} title={reporting.authorId ? 'Report review' : 'Report message'} onClose={closeReport} onSubmit={(reason, details) => submitReport(reporting, reason, details)} />}
  </>
}
