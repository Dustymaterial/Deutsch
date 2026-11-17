import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Ellipsis, Lock, Plus, Reply, Search, Users, X } from 'lucide-react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useConfirm } from './confirmContext'
import { useFormValidation } from './formValidation'
import { replyColor } from './replyColor'
import {
  errorMessage, groupsRequest,
  type GroupDirectory, type GroupMessage, type GroupSummary, type Profile,
} from './groupsApi'
import './Groups.css'

const rulesText = 'Groups are open to every member, so anything you post can be read by all of them. Be kind and keep it about learning German. No spam, advertising, personal details or harassment. You must be at least 13. Group owners and moderators can hide messages and remove people, and you can report any message.'

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

const closePopover = (event: React.SyntheticEvent<HTMLElement>) => {
  const details = event.currentTarget.closest('details')
  if (details) details.open = false
}

export function GroupsSidebar({ directory, error, selectedId, onOpen, reload }: {
  directory: GroupDirectory | null
  error: string | null
  selectedId: string | null
  onOpen: (id: string) => void
  reload: () => Promise<void>
}) {
  const confirmDialog = useConfirm()
  const { errors, validate, handleInput } = useFormValidation()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

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
  const mine = matching.filter((group) => group.joined)
  const others = matching.filter((group) => !group.joined)
  const atLimit = directory ? directory.ownedCount >= directory.ownedLimit : true

  const card = (group: GroupSummary) => <article className={`group-card companion-contact-card${selectedId === group.id ? ' selected' : ''}`} key={group.id}>
    <button className="group-card-open companion-contact-open" type="button" disabled={!group.joined} onClick={() => onOpen(group.id)} aria-label={group.joined ? `Open ${group.name}` : undefined}>
      <span className="group-avatar" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase()}</span>
      <span className="group-card-copy">
        <strong>{group.name}</strong>
        <span>{group.description || `Run by ${group.owner.username}`}</span>
        <small><Users size={11} aria-hidden="true" />{group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}{group.state === 'closed' && <><Lock size={11} aria-hidden="true" />Closed</>}</small>
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
    <div className="group-toolbar">
      <div className="group-search">
        <Search size={13} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a group…" aria-label="Find a group" maxLength={40} />
      </div>
      <button className="group-create-toggle" type="button" aria-expanded={creating} disabled={!directory || (atLimit && !creating)} title={atLimit ? `You run ${directory?.ownedLimit ?? 3} groups already` : undefined} onClick={() => setCreating((open) => !open)}>
        {creating ? <X size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}<span>{creating ? 'Cancel' : 'Create'}</span>
      </button>
    </div>
    {creating && <form className="group-create-form" noValidate onInput={handleInput} onSubmit={create}>
      <label className="companion-field">Group name
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={40} required aria-invalid={Boolean(errors.name) || undefined} placeholder="Beginners’ corner" />
        {errors.name && <span className="field-error">{errors.name}</span>}
      </label>
      <label className="companion-field">What is it for? (optional)
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={200} rows={2} placeholder="Questions and practice for A1 learners" />
        <small>{description.length}/200</small>
      </label>
      <p className="group-create-note">You can run up to {directory?.ownedLimit ?? 3} groups ({directory?.ownedCount ?? 0} used). Close a group to stop new members from joining.</p>
      <button className="companion-primary-button" type="submit" disabled={busy}>Create group</button>
    </form>}
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
  for (const message of incoming) map.set(message.id, message)
  return [...map.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function GroupConversation({ group, canModerate, onClose, reload }: {
  group: GroupSummary
  canModerate: boolean
  onClose: () => void
  reload: () => Promise<void>
}) {
  const confirmDialog = useConfirm()
  const [messages, setMessages] = useState<GroupMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [members, setMembers] = useState<{ list: (Profile & { role: string })[]; canRemove: boolean } | null>(null)
  const [reporting, setReporting] = useState<{ id: string; reason: string; details: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const { errors: renameErrors, validate: validateRename, handleInput: handleRenameInput } = useFormValidation()
  const stream = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const firstLoad = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await groupsRequest<{ messages: GroupMessage[]; hasMore: boolean; group: GroupSummary }>(`/${group.id}/messages`)
      setMessages((current) => mergeMessages(current, data.messages))
      if (data.group.name !== group.name) await reload()
      if (firstLoad.current) {
        firstLoad.current = false
        setHasOlder(data.hasMore)
      }
      setLoaded(true)
      setError(null)
    } catch (failure) {
      setError(errorMessage(failure, 'Could not load messages.'))
      setLoaded(true)
    }
  }, [group.id, group.name, reload])

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0)
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const timer = window.setInterval(refresh, 5000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])

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
    setLoadingOlder(true)
    const previousHeight = element.scrollHeight
    void groupsRequest<{ messages: GroupMessage[]; hasMore: boolean }>(`/${group.id}/messages?before=${encodeURIComponent(oldest.createdAt)}`)
      .then((data) => {
        setMessages((current) => mergeMessages(current, data.messages))
        setHasOlder(data.hasMore)
        requestAnimationFrame(() => { element.scrollTop += element.scrollHeight - previousHeight })
      })
      .catch((failure: unknown) => setError(errorMessage(failure, 'Could not load earlier messages.')))
      .finally(() => setLoadingOlder(false))
  }

  const send = (event: React.FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    void run(async () => {
      const data = await groupsRequest<{ message: GroupMessage }>(`/${group.id}/messages`, { text, ...(replyTo ? { replyToId: replyTo.id } : {}) })
      stickToBottom.current = true
      setMessages((current) => mergeMessages(current, [data.message]))
      setDraft('')
      setReplyTo(null)
    })
  }

  const unsend = async (message: GroupMessage) => {
    const ok = await confirmDialog({ title: 'Unsend this message?', message: 'It is replaced with “Message unsent” for everyone in the group.', confirmLabel: 'Unsend', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/messages/${message.id}/unsend`, {})
      await load()
    })
  }

  const hide = async (message: GroupMessage) => {
    const ok = await confirmDialog({ title: 'Hide this message?', message: `${message.sender?.username ?? 'The author'}’s message is hidden from everyone in the group. This cannot be undone.`, confirmLabel: 'Hide message', tone: 'danger' })
    if (!ok) return
    await run(async () => {
      await groupsRequest(`/${group.id}/messages/${message.id}/hide`, {})
      await load()
    })
  }

  const submitReport = (event: React.FormEvent) => {
    event.preventDefault()
    if (!reporting) return
    void run(async () => {
      await groupsRequest(`/${group.id}/messages/${reporting.id}/report`, { reason: reporting.reason, ...(reporting.details.trim() ? { details: reporting.details.trim() } : {}) })
      setReporting(null)
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

  const rename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateRename(event.currentTarget)) return
    const name = newName.trim().replace(/\s+/g, ' ')
    if (name === group.name) {
      setRenaming(false)
      return
    }
    void (async () => {
      const confirmed = await confirmDialog({
        title: 'Change group name?',
        message: `The group will be called “${name}” and members will see a notice in the chat.`,
        confirmLabel: 'Change name',
      })
      if (!confirmed) return
      await run(async () => {
        await groupsRequest(`/${group.id}/name`, { name })
        setRenaming(false)
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
      onClose()
      await reload()
    })
  }

  const jumpTo = (id: string) => {
    const target = document.getElementById(`group-message-${id}`)
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <>
    <header className="companion-chat-header">
      <button className="group-back" type="button" onClick={onClose} aria-label="Back to groups"><ChevronLeft size={17} aria-hidden="true" /></button>
      <span className="group-avatar" aria-hidden="true">{group.name.slice(0, 1).toLocaleUpperCase()}</span>
      <div className="companion-chat-identity">
        <h2>{group.name}</h2>
        <span className={`companion-status-tag ${group.state === 'open' ? 'connected' : 'outgoing'}`}>{group.state === 'open' ? 'Open' : 'Closed'}</span>
      </div>
      <div className="companion-chat-header-actions">
        <button className="companion-header-pill" type="button" aria-pressed={membersOpen} onClick={toggleMembers}><Users size={14} aria-hidden="true" /><span>{group.memberCount}</span></button>
        <details className="companion-row-menu companion-chat-menu">
          <summary className="companion-header-pill" aria-label="Group actions"><Ellipsis size={15} aria-hidden="true" /><span>More</span></summary>
          <div className="companion-row-popover">
            {(group.isOwner || canModerate) && <button type="button" onClick={(event) => { closePopover(event); setNewName(group.name); setRenaming(true) }}>Change group name</button>}
            {(group.isOwner || canModerate) && <button type="button" onClick={(event) => { closePopover(event); void setState(group.state === 'open' ? 'closed' : 'open') }}>{group.state === 'open' ? 'Close to new members' : 'Open to new members'}</button>}
            {(group.isOwner || canModerate) && <button className="danger" type="button" onClick={(event) => { closePopover(event); void deleteGroup() }}>Delete group</button>}
            {!group.isOwner && <button className="danger" type="button" onClick={(event) => { closePopover(event); void leave() }}>Leave group</button>}
          </div>
        </details>
      </div>
    </header>
    {renaming && <form className="group-rename-form" noValidate onInput={handleRenameInput} onSubmit={rename}>
      <label className="companion-field">Group name
        <input name="name" value={newName} onChange={(event) => setNewName(event.target.value)} minLength={3} maxLength={40} required aria-invalid={Boolean(renameErrors.name) || undefined} aria-describedby={renameErrors.name ? 'group-rename-error' : undefined} autoFocus />
        {renameErrors.name && <span className="field-error" id="group-rename-error">{renameErrors.name}</span>}
      </label>
      <div className="companion-card-actions">
        <button type="submit" disabled={busy}>Save name</button>
        <button type="button" disabled={busy} onClick={() => setRenaming(false)}>Cancel</button>
      </div>
    </form>}
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
    <div className="companion-chat-stream" ref={stream} role="log" aria-label={`Messages in ${group.name}`} aria-live="polite">
      {hasOlder && <button className="companion-load-older" type="button" disabled={loadingOlder} onClick={loadOlder}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
      {!loaded ? <p className="companion-empty-note">Loading messages…</p> : messages.length === 0
        ? <div className="companion-chat-empty"><img className="companion-welcome-logo" src="/app-icon.svg" alt="" /><p>Say hello to the group.</p><span>Ask a question, share a tip, or welcome someone new.</span></div>
        : messages.map((message) => message.kind === 'system'
          ? <p className="group-system-message" key={message.id}>{message.text}</p>
          : <article className="companion-message-row group-message" id={`group-message-${message.id}`} key={message.id}>
          <div className="companion-message-content">
            {message.replyTo && message.kind === 'text' && <button className="companion-reply-quote" style={replyColor(message.replyTo.id)} type="button" onClick={() => jumpTo(message.replyTo!.id)}>
              <strong>{message.replyTo.isMine ? 'You' : 'Replying to a message'}</strong><span>{message.replyTo.text}</span>
            </button>}
            <div className="companion-message-meta">
              {message.sender && <img className="group-message-avatar" src={avatarDataUri(message.sender.avatarSeed)} alt="" />}
              <strong>{message.isMine ? 'You' : message.sender?.username ?? 'Former member'}</strong>
              <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
            </div>
            {message.kind === 'text'
              ? <p className="companion-message-text">{message.text}</p>
              : <p className="companion-message-unsent">{message.text}</p>}
            {message.kind === 'text' && <div className="group-message-actions">
              <button type="button" onClick={() => { setReplyTo(message); composer.current?.focus() }}><Reply size={12} aria-hidden="true" />Reply</button>
              {message.isMine && <button type="button" disabled={busy} onClick={() => void unsend(message)}>Unsend</button>}
              {!message.isMine && !message.reported && <button type="button" disabled={busy} onClick={() => setReporting({ id: message.id, reason: 'other', details: '' })}>Report</button>}
              {message.reported && <span>Reported</span>}
              {message.canHide && !message.isMine && <button type="button" disabled={busy} onClick={() => void hide(message)}>Hide</button>}
            </div>}
            {reporting?.id === message.id && <form className="companion-report-form" onSubmit={submitReport}>
              <label className="companion-field">Report reason
                <select value={reporting.reason} onChange={(event) => setReporting({ ...reporting, reason: event.target.value })}>
                  <option value="spam">Spam</option>
                  <option value="harassment">Harassment</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="companion-field">Additional details (optional)
                <textarea maxLength={500} value={reporting.details} onChange={(event) => setReporting({ ...reporting, details: event.target.value })} />
              </label>
              <div className="companion-card-actions">
                <button type="submit" disabled={busy}>Submit report</button>
                <button type="button" disabled={busy} onClick={() => setReporting(null)}>Cancel</button>
              </div>
            </form>}
          </div>
        </article>)}
    </div>
    <form className="companion-chat-composer" onSubmit={send}>
      <label className="companion-visually-hidden" htmlFor="group-message">Message {group.name}</label>
      {replyTo && <div className="companion-reply-bar" style={replyColor(replyTo.id)}>
        <span>Replying to <strong>{replyTo.isMine ? 'yourself' : replyTo.sender?.username ?? 'a member'}</strong><em>{replyTo.text}</em></span>
        <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={14} aria-hidden="true" /></button>
      </div>}
      <div className="companion-composer-input">
        <textarea ref={composer} id="group-message" rows={1} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
        }} placeholder="Write to the group…" disabled={busy} />
        <button className="companion-send-button" type="submit" disabled={busy || !draft.trim()}>Send</button>
      </div>
      <div className="companion-composer-footer"><span>{draft.length}/1000</span></div>
    </form>
  </>
}
