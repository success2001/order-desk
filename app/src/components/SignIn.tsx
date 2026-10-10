import { useEffect, useState, type FormEvent } from 'react'
import { authErrorMessage, normaliseCode, normaliseEmail } from '../auth/account'
import { useAuth } from '../auth/useAuth'
import { auth } from '../auth/client'

const RESEND_SECONDS = 60

export function SignIn() {
  const { signedIn } = useAuth()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [emailInput, setEmailInput] = useState('')
  const [email, setEmail] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  async function sendCode(address: string) {
    setBusy(true)
    setError(null)
    let sendError: unknown
    try {
      ;({ error: sendError } = await auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      }))
    } catch (err) {
      sendError = err
    }
    setBusy(false)
    if (sendError) {
      setError(authErrorMessage(sendError, navigator.onLine))
      return false
    }
    setResendIn(RESEND_SECONDS)
    return true
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    const address = normaliseEmail(emailInput)
    if (!address) {
      setError('Enter a valid email address, e.g. ada@gmail.com')
      return
    }
    if (await sendCode(address)) {
      setEmail(address)
      setCodeInput('')
      setStep('code')
    }
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault()
    const code = normaliseCode(codeInput)
    if (!code) {
      setError('Enter the code from the email (numbers only).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: verifyError } = await auth.verifyOtp({ email, token: code, type: 'email' })
      if (verifyError || !data.user) throw verifyError
      signedIn({ id: data.user.id, email: data.user.email ?? email })
    } catch (err) {
      setBusy(false)
      setError(authErrorMessage(err, navigator.onLine))
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Order Tracker</h1>
      </header>
      <main className="content signin">
        {step === 'email' ? (
          <form className="form" onSubmit={handleEmail} noValidate>
            <h2>Sign in</h2>
            <p className="muted">We’ll email you a code. No password needed.</p>
            <label className="field">
              <span className="field__label">Email address</span>
              <input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoFocus
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={handleCode} noValidate>
            <h2>Check your email</h2>
            <p className="muted">
              Enter the code we sent to <strong>{email}</strong>. It may take a minute to arrive. Check spam too.
            </p>
            <label className="field">
              <span className="field__label">Code</span>
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                autoFocus
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div className="actions">
              <button type="button" className="button" disabled={busy || resendIn > 0} onClick={() => sendCode(email)}>
                {resendIn > 0 ? `Send again in ${resendIn}s` : 'Send a new code'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setStep('email')
                  setError(null)
                }}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
