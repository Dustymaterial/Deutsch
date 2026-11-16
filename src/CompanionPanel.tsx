import { useCallback, useEffect, useState } from 'react'
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
  try {
    data = await response.json()
  } catch {
    throw new Error('The companion service returned an invalid response.')
  }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? data.error : null
    throw new Error(typeof error === 'string' ? error : 'Could not complete the request.')
  }
  return data
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
  const [emailsEnabled, setEmailsEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [found, setFound] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ user: Profile; action: 'block' | 'remove' } | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareQuery, setShareQuery] = useState('')
  const [selectedCardId, setSelectedCardId] = useState('')
  const [shareNote, setShareNote] = useState('')
  const { errors, validate, handleInput } = useFormValidation()

  const load = useCallback(async () => {
    const data = await request('/') as { companions: Companion[]; sharedWords: SharedWordPreview[]; emailsEnabled: boolean }
    if (!Array.isArray(data.companions) || !Array.isArray(data.sharedWords) || typeof data.emailsEnabled !== 'boolean') throw new Error('The companion service returned an incomplete response.')
    setCompanions(data.companions)
    setSharedWords(data.sharedWords)
    setEmailsEnabled(data.emailsEnabled)
    setLoaded(true)
  }, [])

  useEffect(() => {
    let active = true
    request('/').then((data) => {
      if (!data || typeof data !== 'object' || !('companions' in data) || !Array.isArray(data.companions) || !('sharedWords' in data) || !Array.isArray(data.sharedWords) || !('emailsEnabled' in data) || typeof data.emailsEnabled !== 'boolean') {
        throw new Error('The companion service returned an incomplete response.')
      }
      if (active) {
        setCompanions(data.companions)
        setSharedWords(data.sharedWords)
        setEmailsEnabled(data.emailsEnabled)
        setLoaded(true)
      }
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Could not load companions.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await operation()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete the request.')
    } finally {
      setBusy(false)
    }
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
      setFound(null)
      setConfirm(null)
      setMessage(choice === 'request' ? 'Request sent. It will appear in their companion panel.' : 'Companions updated.')
      try {
        await load()
      } catch {
        setLoaded(false)
        throw new Error('The action was saved, but the list could not be refreshed. Try loading it again.')
      }
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
      setShareOpen(false)
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

  const groups = [
    { status: 'incoming', title: 'Requests for you' },
    { status: 'outgoing', title: 'Sent requests' },
    { status: 'connected', title: 'Your companions' },
    { status: 'blocked', title: 'Blocked learners' },
  ] as const
  const matchingCards = cards.filter((card) => card.status === 'active' && isShareableCard(card) && (!shareQuery.trim()
    || `${card.prompt} ${card.meaning}`.toLocaleLowerCase().includes(shareQuery.trim().toLocaleLowerCase())))

  return (
    <div className="companion-panel">
      <div className="account-popover-heading">
        <div><strong className="menu-panel-title">Learning companions</strong><span>Connect by exact username. Both learners choose to connect.</span></div>
      </div>
      {loading ? <p className="account-message">Loading companions…</p> : !loaded ? (
        <button className="account-submit" disabled={busy} onClick={() => void run(load)} type="button">Try again</button>
      ) : (
        <>
          {sharedWords.length > 0 && <section className="companion-group companion-inbox">
            <h3>Words shared with you</h3>
            {sharedWords.map((share) => <article className="companion-entry shared-word-preview" key={share.id}>
              <div className="companion-person"><img src={avatarDataUri(share.sender.avatarSeed)} alt="" /><strong>{share.sender.username} shared a word</strong></div>
              <p className="shared-word-prompt" lang="de">{share.card.prompt}</p>
              {share.card.plural && <p className="account-message">Plural: <strong lang="de">{share.card.plural}</strong></p>}
              <p className="account-message"><strong>Meaning:</strong> {share.card.meaning}</p>
              <p className="account-message"><strong>Example:</strong> {share.card.example}</p>
              {share.card.translation && <p className="account-message"><strong>Translation:</strong> {share.card.translation}</p>}
              {share.note && <p className="shared-word-note"><strong>Note from {share.sender.username}:</strong> {share.note}</p>}
              <p className="account-message">Preview only. This word is not in your deck until you choose to add it.</p>
              <div className="companion-actions">
                <button type="button" disabled={busy} onClick={() => resolveShare(share, 'add')}>Add to my deck</button>
                <button type="button" disabled={busy} onClick={() => resolveShare(share, 'dismiss')}>Not now</button>
              </div>
            </article>)}
          </section>}
          {companions.some((item) => item.status === 'connected') && <section className="companion-group companion-share">
            <div className="companion-section-heading"><h3>Share a word</h3>
              <button type="button" disabled={busy} onClick={() => { setShareOpen((open) => !open); setSelectedCardId('') }}>
                {shareOpen ? 'Close' : 'Choose from your deck'}
              </button>
            </div>
            {shareOpen && <>
              <label className="account-field">Find a word in your deck
                <input value={shareQuery} onChange={(event) => { setShareQuery(event.target.value); setSelectedCardId('') }} placeholder="Search German or meaning" />
              </label>
              <div className="shared-word-results" role="group" aria-label="Words to share">
                {matchingCards.slice(0, 6).map((card) => <button key={card.id} type="button" className={selectedCardId === card.id ? 'selected' : ''} aria-pressed={selectedCardId === card.id} onClick={() => setSelectedCardId(card.id)}>
                    <strong lang="de">{card.prompt}</strong><span>{card.meaning}</span>
                  </button>)}
                {!matchingCards.length && <p className="account-message">No matching shareable active words in your deck.</p>}
              </div>
              {selectedCardId && <>
                <label className="account-field">Short note (optional)
                  <textarea maxLength={240} value={shareNote} onChange={(event) => setShareNote(event.target.value)} placeholder="Why did this word stand out?" />
                  <small>{shareNote.length}/240</small>
                </label>
                <p className="account-message">Choose a companion to send a preview. They decide whether to add it.</p>
                {companions.filter((item) => item.status === 'connected').map((user) => <button className="account-submit companion-send-word" disabled={busy} key={user.id} type="button" onClick={() => sendWord(user)}>Share with {user.username}</button>)}
              </>}
            </>}
          </section>}
          <form noValidate onInput={handleInput} onSubmit={search}>
            <label className="account-field">Find a learner
              <input name="username" value={username} onChange={(event) => { setUsername(event.target.value); setFound(null) }} aria-invalid={Boolean(errors.username) || undefined} aria-describedby={errors.username ? 'companion-username-error' : undefined} placeholder="Exact username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_\-]+" required />
              {errors.username && <span className="field-error" id="companion-username-error">{errors.username}</span>}
            </label>
            <button className="account-submit" disabled={busy} type="submit">Find username</button>
          </form>
          {found && (
            <div className="companion-entry">
              <div className="companion-person"><img src={avatarDataUri(found.avatarSeed)} alt="" /><strong>{found.username}</strong></div>
              {companions.some((user) => user.id === found.id) && <p className="account-message">This learner is already in your companion list.</p>}
              <div className="companion-actions">
                {!companions.some((user) => user.id === found.id) && <button type="button" disabled={busy} onClick={() => action(found, 'request')}>Send request</button>}
                {!companions.some((user) => user.id === found.id) && <button type="button" disabled={busy} onClick={() => setConfirm({ user: found, action: 'block' })}>Block</button>}
              </div>
            </div>
          )}
          {groups.map(({ status, title }) => {
            const items = companions.filter((item) => item.status === status)
            if (!items.length) return null
            return <section className="companion-group" key={status}>
              <h3>{title}</h3>
              {items.map((user) => <div className="companion-entry" key={user.id}>
                <div className="companion-person"><img src={avatarDataUri(user.avatarSeed)} alt="" /><strong>{user.username}</strong></div>
                <div className="companion-actions">
                  {status === 'incoming' && <><button type="button" disabled={busy} onClick={() => action(user, 'accept')}>Accept</button><button type="button" disabled={busy} onClick={() => action(user, 'decline')}>Decline</button></>}
                  {status === 'outgoing' && <button type="button" disabled={busy} onClick={() => action(user, 'cancel')}>Cancel request</button>}
                  {status === 'connected' && <>
                    <button type="button" disabled={busy || !user.canNudge} onClick={() => sendNudge(user)}>{user.canNudge ? 'Send gentle reminder' : 'Reminder sent in the past day'}</button>
                    <button type="button" disabled={busy} onClick={() => setConfirm({ user, action: 'remove' })}>Remove</button>
                  </>}
                  {status === 'blocked' ? <button type="button" disabled={busy} onClick={() => action(user, 'unblock')}>Unblock</button> : <button type="button" disabled={busy} onClick={() => setConfirm({ user, action: 'block' })}>Block</button>}
                </div>
                {status === 'connected' && user.nudgeAt && <p className="companion-nudge" role="status">{user.username} sent you a gentle reminder. <button type="button" disabled={busy} onClick={() => markNudgeRead(user)}>Got it</button></p>}
              </div>)}
            </section>
          })}
          {confirm && <div className="companion-confirm" role="group" aria-label="Confirm companion action">
            <p>{confirm.action === 'block' ? `Block ${confirm.user.username}? This ends any connection and prevents requests.` : `Remove ${confirm.user.username} from your companions?`}</p>
            <div className="companion-actions">
              <button type="button" disabled={busy} onClick={() => action(confirm.user, confirm.action)}>Yes, {confirm.action}</button>
              <button type="button" disabled={busy} onClick={() => setConfirm(null)}>Not now</button>
            </div>
          </div>}
          <label className="companion-setting">
            <input className="app-checkbox" type="checkbox" checked={emailsEnabled} disabled={busy} onChange={(event) => {
              const value = event.target.checked
              void run(async () => { await request('/settings', { emailsEnabled: value }); setEmailsEnabled(value) })
            }} />
            <span>Email me about companion activity</span>
          </label>
          <p className="account-message">Your email and study progress stay private. Emails are limited and delivery is not guaranteed.</p>
        </>
      )}
      {error && <p className="account-message account-error" role="alert">{error}</p>}
      {message && <p className="account-message" role="status">{message}</p>}
      <button className="account-secondary" disabled={busy} onClick={onBack} type="button">Back to account</button>
    </div>
  )
}
