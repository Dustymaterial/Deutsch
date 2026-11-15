import { useEffect, useState } from 'react'
import { createAvatar, type Style } from '@dicebear/core'
import './AccountMenu.css'

export type AccountUser = {
  username: string
  email: string
  avatarSeed: string
}

const avatarOptions = [
  { seed: 'pixel-lime', label: 'Neon lime', palette: 0, pattern: 0 },
  { seed: 'pixel-red', label: 'Arcade red', palette: 1, pattern: 1 },
  { seed: 'pixel-violet', label: 'Bright violet', palette: 2, pattern: 2 },
  { seed: 'pixel-yellow', label: 'Electric yellow', palette: 3, pattern: 3 },
  { seed: 'pixel-red-gold', label: 'Red and gold', palette: 4, pattern: 4 },
  { seed: 'pixel-green-violet', label: 'Green and violet', palette: 5, pattern: 5 },
  { seed: 'pixel-purple-gold', label: 'Purple and gold', palette: 6, pattern: 6 },
  { seed: 'pixel-black-lime', label: 'Black and lime', palette: 7, pattern: 7 },
]

type PixelTone = 'body' | 'accent' | 'detail' | null

const inBlock = (x: number, y: number, left: number, top: number, right: number, bottom: number) =>
  x >= left && x <= right && y >= top && y <= bottom

const avatarPatterns: Array<(x: number, y: number) => PixelTone> = [
  (x, y) => {
    if (y === 0 && (x === 4 || x === 11)) return 'accent'
    if (inBlock(x, y, 3, 1, 4, 2) || inBlock(x, y, 11, 1, 12, 2)) return 'body'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (y === 6 && inBlock(x, y, 6, 6, 9, 6)) return 'accent'
    if (inBlock(x, y, 3, 3, 12, 7)) return 'body'
    if (inBlock(x, y, 1, 5, 2, 8) || inBlock(x, y, 13, 5, 14, 8)) return 'body'
    if (inBlock(x, y, 3, 8, 5, 10) || inBlock(x, y, 10, 8, 12, 10)) return 'body'
    if (inBlock(x, y, 7, 9, 8, 11)) return 'accent'
    return null
  },
  (x, y) => {
    if (inBlock(x, y, 7, 0, 8, 1)) return 'accent'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (y === 6 && inBlock(x, y, 6, 6, 9, 6)) return 'accent'
    if (inBlock(x, y, 4, 2, 11, 6) || inBlock(x, y, 2, 4, 13, 7)) return 'body'
    if (inBlock(x, y, 3, 8, 4, 11) || inBlock(x, y, 7, 8, 8, 12) || inBlock(x, y, 11, 8, 12, 11)) {
      return y % 2 === 0 ? 'body' : 'accent'
    }
    return null
  },
  (x, y) => {
    if (y === 1 && (x === 2 || x === 13)) return 'accent'
    if (y === 4 && (inBlock(x, y, 6, 4, 7, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (inBlock(x, y, 4, 2, 11, 8)) return y === 7 ? 'accent' : 'body'
    if (inBlock(x, y, 2, 3, 3, 6) || inBlock(x, y, 12, 3, 13, 6)) return 'body'
    if (inBlock(x, y, 0, 4, 1, 5) || inBlock(x, y, 14, 4, 15, 5)) return 'accent'
    if (inBlock(x, y, 3, 9, 5, 11) || inBlock(x, y, 10, 9, 12, 11)) return 'body'
    return null
  },
  (x, y) => {
    if (y === 0 && (x === 5 || x === 10)) return 'accent'
    if (y === 4 && (inBlock(x, y, 4, 4, 5, 4) || inBlock(x, y, 10, 4, 11, 4))) return 'detail'
    if (inBlock(x, y, 5, 1, 10, 8) || inBlock(x, y, 3, 3, 12, 7)) return 'body'
    if (inBlock(x, y, 1, 4, 2, 6) || inBlock(x, y, 13, 4, 14, 6)) return 'accent'
    if (inBlock(x, y, 4, 9, 5, 11) || inBlock(x, y, 10, 9, 11, 11)) return 'body'
    if (inBlock(x, y, 2, 10, 3, 11) || inBlock(x, y, 12, 10, 13, 11)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 2 && (x === 4 || x === 11)) return 'accent'
    if (y === 5 && (inBlock(x, y, 5, 5, 6, 5) || inBlock(x, y, 9, 5, 10, 5))) return 'detail'
    if (inBlock(x, y, 3, 3, 12, 8)) return y === 8 ? 'accent' : 'body'
    if (inBlock(x, y, 1, 5, 2, 7) || inBlock(x, y, 13, 5, 14, 7)) return 'body'
    if (inBlock(x, y, 4, 9, 6, 12) || inBlock(x, y, 9, 9, 11, 12)) return 'body'
    if (inBlock(x, y, 7, 10, 8, 12)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 0 && (x === 6 || x === 9)) return 'accent'
    if (y === 5 && (x === 5 || x === 10)) return 'detail'
    if (inBlock(x, y, 4, 2, 11, 8)) return 'body'
    if (inBlock(x, y, 2, 4, 3, 7) || inBlock(x, y, 12, 4, 13, 7)) return 'accent'
    if (inBlock(x, y, 5, 9, 6, 11) || inBlock(x, y, 9, 9, 10, 11)) return 'body'
    if (inBlock(x, y, 3, 11, 4, 12) || inBlock(x, y, 11, 11, 12, 12)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 2 && (x === 3 || x === 12)) return 'accent'
    if (y === 4 && (inBlock(x, y, 5, 4, 6, 4) || inBlock(x, y, 9, 4, 10, 4))) return 'detail'
    if (inBlock(x, y, 4, 3, 11, 7) || inBlock(x, y, 2, 5, 13, 8)) return 'body'
    if (inBlock(x, y, 0, 6, 1, 7) || inBlock(x, y, 14, 6, 15, 7)) return 'accent'
    if (inBlock(x, y, 3, 9, 5, 10) || inBlock(x, y, 10, 9, 12, 10)) return 'body'
    if (inBlock(x, y, 6, 9, 9, 10)) return 'accent'
    return null
  },
  (x, y) => {
    if (y === 1 && (x === 5 || x === 10)) return 'accent'
    if (y === 5 && (inBlock(x, y, 5, 5, 6, 5) || inBlock(x, y, 9, 5, 10, 5))) return 'detail'
    if (inBlock(x, y, 3, 3, 12, 8)) return (x + y) % 4 === 0 ? 'accent' : 'body'
    if (inBlock(x, y, 1, 5, 2, 7) || inBlock(x, y, 13, 5, 14, 7)) return 'body'
    if (inBlock(x, y, 4, 10, 5, 12) || inBlock(x, y, 10, 10, 11, 12)) return 'accent'
    return null
  },
]

const avatarPalettes = [
  { body: '#57F287', accent: '#F6F24A', detail: '#10121C' },
  { body: '#FF4D5A', accent: '#FFD447', detail: '#10121C' },
  { body: '#C45BFF', accent: '#4CF4E8', detail: '#10121C' },
  { body: '#E8C426', accent: '#FF5E78', detail: '#10121C' },
  { body: '#FF4D5A', accent: '#E7BD36', detail: '#090A10' },
  { body: '#57F287', accent: '#C45BFF', detail: '#090A10' },
  { body: '#B966FF', accent: '#E7BD36', detail: '#090A10' },
  { body: '#82D622', accent: '#303030', detail: '#090A10' },
]

type GeometricAvatarOptions = { paletteIndex?: number }

const pixelAvatar: Style<GeometricAvatarOptions> = {
  create: ({ prng }) => {
    const option = avatarOptions.find((item) => item.seed === prng.seed)
    const palette = avatarPalettes[option?.palette ?? prng.integer(0, avatarPalettes.length - 1)]
    const pattern = avatarPatterns[option?.pattern ?? prng.integer(0, avatarPatterns.length - 1)]
    const pixels = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => {
        const tone = pattern(x, y)
        const fill = tone ? palette[tone] : null
        return fill ? [`<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${fill}"/>`] : []
      }),
    ).flat(2)
    return {
      attributes: { viewBox: '0 0 18 18', 'shape-rendering': 'crispEdges' },
      body: pixels.join(''),
    }
  },
}

const avatarDataUri = (seed: string) =>
  createAvatar(pixelAvatar, { seed, size: 72 }).toDataUri()

const defaultAvatarSeed = avatarOptions[0].seed

const responseBody = async (response: Response) => {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.status >= 500) {
      throw new Error('Could not reach the account service. Restart the app with npm run dev and configure DB_URL in .env.')
    }
    throw new Error('The account server returned an invalid response.')
  }
  if (!body || typeof body !== 'object') {
    throw new Error('The server returned an invalid response.')
  }
  return body as { user?: AccountUser; error?: string }
}

export function AccountMenu({
  onUserChange,
  syncStatus,
  open,
  onOpenChange,
}: {
  onUserChange: (user: AccountUser | null) => void
  syncStatus?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [user, setUser] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [avatarSeed, setAvatarSeed] = useState(defaultAvatarSeed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
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
    setBusy(true)
    setError(null)
    setNotice(null)
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
      if (!response.ok) throw new Error(body.error ?? 'Could not sign in.')
      if (!body.user) throw new Error('The server returned an incomplete account.')
      setUser(body.user)
      setUsername(body.user.username)
      setAvatarSeed(body.user.avatarSeed)
      onUserChange(body.user)
      setPassword('')
      setNotice(registering ? 'Your account is ready.' : 'Welcome back.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
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
      setNotice('Profile saved.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update your profile.')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(body.error ?? 'Could not sign out.')
      setUser(null)
      setUsername('')
      setAvatarSeed(defaultAvatarSeed)
      setEmail('')
      onUserChange(null)
      setNotice('You are signed out.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details
      className="account-menu has-avatar"
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      open={open}
    >
      <summary
        aria-label={user ? `Account settings for ${user.username}` : 'Open account menu'}
        className="account-menu-trigger"
      >
        <img src={avatarDataUri(avatarSeed)} alt="" />
      </summary>
      <section className="account-popover" aria-label="Account">
        <button
          className="account-back"
          onClick={() => {
            onOpenChange(false)
          }}
          type="button"
        >
          <span aria-hidden="true">←</span> Back to menu
        </button>
        {loading ? (
          <p className="account-message">Checking account…</p>
        ) : user ? (
          <>
            <div className="account-popover-heading">
              <img src={avatarDataUri(avatarSeed || user.avatarSeed)} alt="" />
              <div>
                <strong>Your account</strong>
                <span>{user.email}</span>
              </div>
            </div>
            <form onSubmit={saveProfile}>
              <label className="account-field">
                Username
                <input
                  autoComplete="username"
                  maxLength={20}
                  minLength={3}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  value={username}
                />
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
            <button className="account-secondary" disabled={busy} onClick={signOut} type="button">
              Sign out
            </button>
            {syncStatus && <p className="account-message" role="status">{syncStatus}</p>}
          </>
        ) : (
          <>
            <div className="account-popover-heading">
              <div>
                <strong>{registering ? 'Create your account' : 'Welcome back'}</strong>
                <span>Save your deck and progress across devices.</span>
              </div>
            </div>
            <form onSubmit={submitCredentials}>
              {registering && (
                <>
                  <label className="account-field">
                    Username
                    <input
                      autoComplete="username"
                      maxLength={20}
                      minLength={3}
                      onChange={(event) => setUsername(event.target.value)}
                      pattern="[A-Za-z0-9_-]+"
                      placeholder="3–20 letters or numbers"
                      required
                      value={username}
                    />
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
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label className="account-field">
                Password
                <input
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  minLength={10}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
                {registering && <small>Use at least 10 characters.</small>}
              </label>
              <button className="account-submit" disabled={busy} type="submit">
                {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
              </button>
            </form>
            <button
              className="account-secondary"
              onClick={() => {
                setRegistering((value) => !value)
                setError(null)
                setNotice(null)
              }}
              type="button"
            >
              {registering ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </button>
          </>
        )}
        {error && <p className="account-message account-error" role="alert">{error}</p>}
        {notice && <p className="account-message" role="status">{notice}</p>}
      </section>
    </details>
  )
}
