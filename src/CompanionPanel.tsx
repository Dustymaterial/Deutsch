import { useCallback, useEffect, useState } from 'react'
import { avatarDataUri } from './pixelAvatar.mjs'
import { useFormValidation } from './formValidation'

type Profile = { id: string; username: string; avatarSeed: string }
type Companion = Profile & { status: 'incoming' | 'outgoing' | 'connected' | 'blocked' }
type Action = 'accept' | 'decline' | 'cancel' | 'remove' | 'block' | 'unblock'

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

export function CompanionPanel({ onBack }: { onBack: () => void }) {
  const [companions, setCompanions] = useState<Companion[]>([])
  const [emailsEnabled, setEmailsEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [found, setFound] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ user: Profile; action: 'block' | 'remove' } | null>(null)
  const { errors, validate, handleInput } = useFormValidation()

  const load = useCallback(async () => {
    const data = await request('/') as { companions: Companion[]; emailsEnabled: boolean }
    if (!Array.isArray(data.companions) || typeof data.emailsEnabled !== 'boolean') throw new Error('The companion service returned an incomplete response.')
    setCompanions(data.companions)
    setEmailsEnabled(data.emailsEnabled)
    setLoaded(true)
  }, [])

  useEffect(() => {
    let active = true
    request('/').then((data) => {
      if (!data || typeof data !== 'object' || !('companions' in data) || !Array.isArray(data.companions) || !('emailsEnabled' in data) || typeof data.emailsEnabled !== 'boolean') {
        throw new Error('The companion service returned an incomplete response.')
      }
      if (active) {
        setCompanions(data.companions)
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

  const groups = [
    { status: 'incoming', title: 'Requests for you' },
    { status: 'outgoing', title: 'Sent requests' },
    { status: 'connected', title: 'Your companions' },
    { status: 'blocked', title: 'Blocked learners' },
  ] as const

  return (
    <div className="companion-panel">
      <div className="account-popover-heading">
        <div><strong className="menu-panel-title">Learning companions</strong><span>Connect by exact username. Both learners choose to connect.</span></div>
      </div>
      {loading ? <p className="account-message">Loading companions…</p> : !loaded ? (
        <button className="account-submit" disabled={busy} onClick={() => void run(load)} type="button">Try again</button>
      ) : (
        <>
          <form noValidate onInput={handleInput} onSubmit={search}>
            <label className="account-field">Find a learner
              <input name="username" value={username} onChange={(event) => { setUsername(event.target.value); setFound(null) }} aria-invalid={Boolean(errors.username) || undefined} aria-describedby={errors.username ? 'companion-username-error' : undefined} placeholder="Exact username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_-]+" required />
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
                  {status === 'connected' && <button type="button" disabled={busy} onClick={() => setConfirm({ user, action: 'remove' })}>Remove</button>}
                  {status === 'blocked' ? <button type="button" disabled={busy} onClick={() => action(user, 'unblock')}>Unblock</button> : <button type="button" disabled={busy} onClick={() => setConfirm({ user, action: 'block' })}>Block</button>}
                </div>
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
            <input type="checkbox" checked={emailsEnabled} disabled={busy} onChange={(event) => {
              const value = event.target.checked
              void run(async () => { await request('/settings', { emailsEnabled: value }); setEmailsEnabled(value) })
            }} />
            <span>Email me about companion requests</span>
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
