import { useEffect, useState } from 'react'
import { avatarDataUri, avatarOptions, defaultAvatarSeed } from './pixelAvatar.mjs'
import { Eye, EyeOff } from 'lucide-react'
import { useFormValidation } from './formValidation'
import { AccountSecurityPanel } from './AccountSecurityPanel'
import { useConfirm } from './confirmContext'
import './AccountMenu.css'

export type AccountUser = {
  id: string
  username: string
  email: string
  avatarSeed: string
  emailVerified?: boolean
}

const responseBody = async (response: Response) => {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.status >= 500) {
      throw new Error('Could not reach the account service. Restart the app with npm run dev and configure the MongoDB settings in .env.')
    }
    throw new Error('The account server returned an invalid response.')
  }
  if (!body || typeof body !== 'object') {
    throw new Error('The server returned an invalid response.')
  }
  return body as { user?: AccountUser; error?: string; verificationRequired?: boolean }
}

export function AccountMenu({
  onUserChange,
  syncStatus,
  open,
  onOpenChange,
  onNotify,
  onOpenCompanions,
}: {
  onUserChange: (user: AccountUser | null) => void
  syncStatus?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onNotify: (message: string) => void
  onOpenCompanions: () => void
}) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [avatarSeed, setAvatarSeed] = useState(defaultAvatarSeed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [securityMode, setSecurityMode] = useState<'verify' | 'reset' | 'change' | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const { errors, validate, handleInput, clearErrors } = useFormValidation()
  useEffect(() => {
    let active = true
    fetch('/api/auth/me')
      .then(async (response) => {
        if (response.status === 401) return null
        const body = await responseBody(response)
        if (!response.ok) throw new Error(body.error ?? 'Could not load your account.')
        if (!body.user) throw new Error('The server returned an incomplete account.')
        return body.user
      })
      .then((account) => {
        if (!active) return
        setUser(account)
        setUsername(account?.username ?? '')
        setAvatarSeed(account?.avatarSeed ?? defaultAvatarSeed)
        onUserChange(account)
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load your account.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [onUserChange])

  const submitCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validate(event.currentTarget)) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(registering ? { username, avatarSeed } : {}),
        }),
      })
      const body = await responseBody(response)
      if (body.verificationRequired) {
        setSecurityMode('verify')
        setCodeSent(response.ok && registering)
        setPassword('')
        setShowPassword(false)
        if (!response.ok) setError(body.error ?? 'Please verify your email.')
        return
      }
      if (!response.ok) throw new Error(body.error ?? 'Could not sign in.')
      if (!body.user) throw new Error('The server returned an incomplete account.')
      setUser(body.user)
      setUsername(body.user.username)
      setAvatarSeed(body.user.avatarSeed)
      onUserChange(body.user)
      setPassword('')
      setShowPassword(false)
      onNotify('Welcome back.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  const refreshVerifiedAccount = async () => {
    if (!user) return
    const response = await fetch('/api/auth/me')
    const body = await responseBody(response)
    if (!response.ok || !body.user) throw new Error(body.error ?? 'Could not refresh your account.')
    setUser(body.user)
    onUserChange(body.user)
  }

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validate(event.currentTarget)) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, avatarSeed }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error ?? 'Could not update your profile.')
      if (!body.user) throw new Error('The server returned an incomplete profile.')
      setUser(body.user)
      setUsername(body.user.username)
      setAvatarSeed(body.user.avatarSeed)
      onUserChange(body.user)
      onNotify('Profile saved.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update your profile.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = useConfirm()
  const requestSignOut = async () => {
    const confirmed = await confirm({
      title: 'Sign out?',
      message: 'You will stop syncing and using companions on this device until you sign in again. Your deck stays saved on this device.',
      confirmLabel: 'Sign out',
    })
    if (confirmed) await signOut()
  }

  const signOut = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error ?? 'Could not sign out.')
      setUser(null)
      setUsername('')
      setAvatarSeed(defaultAvatarSeed)
      setEmail('')
      onUserChange(null)
      setShowPassword(false)
      onNotify('You are signed out.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details
      className="account-menu has-avatar"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.currentTarget.open) {
          event.preventDefault()
          event.currentTarget.open = false
          onOpenChange(false)
          event.currentTarget.querySelector('summary')?.focus()
        }
      }}
      onToggle={(event) => {
        const isOpen = event.currentTarget.open
        if (!isOpen) setShowPassword(false)
        onOpenChange(isOpen)
      }}
      open={open}
    >
      <summary
        aria-label={user ? `Account settings for ${user.username}` : 'Open account menu'}
        className="account-menu-trigger"
      >
        <img src={avatarDataUri(avatarSeed)} alt="" />
      </summary>
      <section className="account-popover" aria-label="Account">
        {loading ? (
          <p className="account-message">Checking account…</p>
        ) : securityMode ? (
          <AccountSecurityPanel
            mode={securityMode}
            initialEmail={user?.email ?? email}
            codeSent={codeSent}
            emailLocked={Boolean(user)}
            onVerified={refreshVerifiedAccount}
            onNotify={onNotify}
            onBack={() => { setSecurityMode(null); setRegistering(false); setError(null); clearErrors() }}
          />
        ) : user ? (
          <>
            <div className="account-popover-heading">
              <img src={avatarDataUri(avatarSeed || user.avatarSeed)} alt="" />
              <div>
                <strong className="menu-panel-title">Your account</strong>
                <span>{user.email}</span>
              </div>
            </div>
            <form noValidate onInput={handleInput} onSubmit={saveProfile}>
              <label className="account-field">
                Username
                <input
                  autoComplete="username"
                  name="username"
                  aria-label="Username"
                  aria-invalid={Boolean(errors.username) || undefined}
                  aria-describedby={errors.username ? 'account-username-error' : 'account-username-hint'}
                  maxLength={20}
                  minLength={3}
                  onChange={(event) => setUsername(event.target.value)}
                  pattern="[A-Za-z0-9_\-]+"
                  required
                  value={username}
                />
                {errors.username && <span className="field-error" id="account-username-error">{errors.username}</span>}
                {!errors.username && <small id="account-username-hint">3–20 letters, numbers, underscores, or hyphens; not an email address.</small>}
              </label>
              <fieldset className="avatar-picker">
                <legend>Pixel avatar</legend>
                <div className="avatar-options">
                  {avatarOptions.map(({ seed, label }) => (
                    <button
                      aria-label={`Choose ${label} pixel avatar`}
                      aria-pressed={(avatarSeed || user.avatarSeed) === seed}
                      className="avatar-option"
                      key={seed}
                      onClick={() => setAvatarSeed(seed)}
                      type="button"
                    >
                      <img src={avatarDataUri(seed)} alt="" />
                    </button>
                  ))}
                </div>
              </fieldset>
              <button className="account-submit" disabled={busy} type="submit">
                Save profile
              </button>
            </form>
            {!user.emailVerified && (
              <>
                <button className="account-secondary" disabled={busy} onClick={() => {
                  setError(null); setCodeSent(false); setSecurityMode('verify')
                }} type="button">Verify email</button>
                <p className="account-message">Verify your email to connect with learning companions.</p>
              </>
            )}
            {user.emailVerified && <button className="account-secondary" disabled={busy} onClick={() => {
              onOpenCompanions()
            }} type="button">Learning companions</button>}
            <button className="account-secondary" disabled={busy} onClick={() => {
              setError(null); setSecurityMode('change')
            }} type="button">Change password</button>
            <button className="account-secondary" disabled={busy} onClick={() => void requestSignOut()} type="button">
              Sign out
            </button>
            {syncStatus && <p className="account-message" role="status">{syncStatus}</p>}
          </>
        ) : (
          <>
            <div className="account-popover-heading">
              <div>
                <strong className="menu-panel-title">{registering ? 'Create your account' : 'Welcome back'}</strong>
                <span>Save your deck and progress across devices.</span>
              </div>
            </div>
            <form noValidate onInput={handleInput} onSubmit={submitCredentials}>
              {registering && (
                <>
                  <label className="account-field">
                    Username
                    <input
                      autoComplete="nickname"
                      name="username"
                      aria-label="Username"
                      aria-invalid={Boolean(errors.username) || undefined}
                      aria-describedby={errors.username ? 'account-username-error' : 'account-username-hint'}
                      maxLength={20}
                      minLength={3}
                      onChange={(event) => setUsername(event.target.value)}
                      pattern="[A-Za-z0-9_\-]+"
                      placeholder="e.g. learner_123"
                      required
                      value={username}
                    />
                    {errors.username && <span className="field-error" id="account-username-error">{errors.username}</span>}
                    {!errors.username && <small id="account-username-hint">3–20 letters, numbers, underscores, or hyphens; not an email address.</small>}
                  </label>
                  <fieldset className="avatar-picker">
                    <legend>Choose your pixel avatar</legend>
                    <div className="avatar-options">
                      {avatarOptions.map(({ seed, label }) => (
                        <button
                          aria-label={`Choose ${label} pixel avatar`}
                          aria-pressed={avatarSeed === seed}
                          className="avatar-option"
                          key={seed}
                          onClick={() => setAvatarSeed(seed)}
                          type="button"
                        >
                          <img src={avatarDataUri(seed)} alt="" />
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <label className="account-field">
                Email
                <input
                  autoComplete="email"
                  name="email"
                  aria-label="Email"
                  aria-invalid={Boolean(errors.email) || undefined}
                  aria-describedby={errors.email ? 'account-email-error' : undefined}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
                {errors.email && <span className="field-error" id="account-email-error">{errors.email}</span>}
              </label>
              <div className="account-field">
                <label htmlFor="account-password">Password</label>
                <div className="password-control">
                  <input
                    id="account-password"
                    name="password"
                    aria-invalid={Boolean(errors.password) || undefined}
                    aria-describedby={errors.password ? 'account-password-error' : registering ? 'account-password-hint' : undefined}
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    minLength={10}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                  />
                  <button type="button" className="password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
                {errors.password && <span className="field-error" id="account-password-error">{errors.password}</span>}
                {registering && !errors.password && <small id="account-password-hint">Use at least 10 characters.</small>}
              </div>
              <button className="account-submit" disabled={busy} type="submit">
                {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
              </button>
            </form>
            {!registering && (
              <button className="account-secondary" onClick={() => {
                setError(null); setCodeSent(false); setSecurityMode('reset')
              }} type="button">Forgot password?</button>
            )}
            <button
              className="account-secondary"
              onClick={() => {
                setRegistering((value) => !value)
                setError(null)
                setShowPassword(false)
                clearErrors()
              }}
              type="button"
            >
              {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </>
        )}
        {error && <p className="account-message account-error" role="alert">{error}</p>}
      </section>
    </details>
  )
}
