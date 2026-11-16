import { useEffect, useRef, useState } from 'react'
import { useFormValidation } from './formValidation'

type Mode = 'verify' | 'reset' | 'change'

export function AccountSecurityPanel({ mode, initialEmail, codeSent, emailLocked, onBack, onVerified, onNotify }: {
  mode: Mode
  initialEmail: string
  codeSent: boolean
  emailLocked: boolean
  onBack: () => void
  onVerified: () => Promise<void>
  onNotify: (message: string) => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [stage, setStage] = useState<'request' | 'code'>(codeSent ? 'code' : 'request')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const { errors, validate, handleInput, clearErrors } = useFormValidation()
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    const name = mode === 'change' ? 'currentPassword' : stage === 'code' ? 'code' : 'email'
    formRef.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus()
  }, [mode, stage])

  const post = async (path: string, data: object) => {
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error('The account server returned an invalid response.')
    }
    if (!response.ok) {
      const errorText = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error : 'The request could not be completed.'
      throw new Error(errorText)
    }
  }

  const sendCode = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await post('code', { email, purpose: mode })
      setStage('code')
      clearErrors()
      setMessage('If the address is eligible, a code will be sent. You can request another after one minute, up to three per hour.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validate(event.currentTarget)) return
    if (mode !== 'change' && stage === 'request') {
      await sendCode()
      return
    }
    if (mode !== 'change' && !/^\d{6}$/.test(code)) {
      setError('Enter the six-digit code from your email.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'verify') {
        await post('verify', { email, code })
        await onVerified()
        onNotify('Email verified.')
      } else if (mode === 'reset') {
        await post('reset-password', { email, code, password })
        onNotify('Password reset. You can sign in now.')
      } else {
        await post('change-password', { currentPassword, password })
        onNotify('Password changed.')
      }
      onBack()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'verify' ? 'Verify your email' : mode === 'reset' ? 'Reset your password' : 'Change your password'
  return (
    <>
      <div className="account-popover-heading">
        <div>
          <strong className="menu-panel-title">{title}</strong>
          <span>{mode === 'change' ? 'Other sessions will be signed out.' : 'We’ll send a six-digit code to your email.'}</span>
        </div>
      </div>
      <form ref={formRef} noValidate onInput={handleInput} onSubmit={submit}>
        {mode !== 'change' && (
          <label className="account-field">
            Email
            <input name="email" type="email" autoComplete="email" required value={email} readOnly={emailLocked}
              onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(errors.email) || undefined}
              aria-describedby={errors.email ? 'security-email-error' : undefined} />
            {errors.email && <span className="field-error" id="security-email-error">{errors.email}</span>}
          </label>
        )}
        {mode !== 'change' && stage === 'code' && (
          <label className="account-field">
            Six-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
              onChange={(event) => setCode(event.target.value)} aria-invalid={Boolean(errors.code) || undefined}
              aria-describedby={errors.code ? 'security-code-error' : undefined} />
            {errors.code && <span className="field-error" id="security-code-error">{errors.code}</span>}
          </label>
        )}
        {mode === 'change' && (
          <label className="account-field">
            Current password
            <input name="currentPassword" type="password" autoComplete="current-password" minLength={10} required
              value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}
              aria-invalid={Boolean(errors.currentPassword) || undefined}
              aria-describedby={errors.currentPassword ? 'security-current-error' : undefined} />
            {errors.currentPassword && <span className="field-error" id="security-current-error">{errors.currentPassword}</span>}
          </label>
        )}
        {(mode === 'change' || (mode === 'reset' && stage === 'code')) && (
          <label className="account-field">
            New password
            <input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required
              value={password} onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.newPassword) || undefined}
              aria-describedby={errors.newPassword ? 'security-password-error' : 'security-password-hint'} />
            {errors.newPassword
              ? <span className="field-error" id="security-password-error">{errors.newPassword}</span>
              : <small id="security-password-hint">Use at least 10 characters and no more than 72 bytes.</small>}
          </label>
        )}
        <button className="account-submit" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'change' ? 'Change password' : stage === 'request' ? 'Send code' : mode === 'verify' ? 'Verify email' : 'Reset password'}
        </button>
      </form>
      {mode !== 'change' && stage === 'code' && (
        <button className="account-secondary" disabled={busy} type="button" onClick={sendCode}>Send another code</button>
      )}
      <button className="account-secondary" disabled={busy} type="button" onClick={onBack}>Back</button>
      {message && <p className="account-message" role="status">{message}</p>}
      {error && <p className="account-message account-error" role="alert">{error}</p>}
    </>
  )
}
