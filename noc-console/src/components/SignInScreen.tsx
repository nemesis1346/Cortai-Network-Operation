import { useState } from 'react'
import type { ApiError, AuthOperator } from '../api/types'
import { OTP_CODE_LENGTH } from '../domain/constants'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'

type Step = 'email' | 'code' | 'desk'

/** Error copy matching the sign-in-problems help article's table — same
 * wording family, adapted from password-era to the code step (DECISIONS.md:
 * those articles' own copy gets the same treatment once Part 8 reaches help
 * wiring; this screen doesn't wait on that). */
function errorText(e: ApiError): string {
  switch (e.code) {
    case 'INVALID_CODE':
      return `That code doesn't match. ${e.attemptsLeft} attempt${e.attemptsLeft === 1 ? '' : 's'} left.`
    case 'CODE_EXPIRED':
      return 'This code has expired. Request a new one.'
    case 'EMAIL_LOCKED':
      return 'Too many wrong codes. This email is locked for a few minutes — ask the desk supervisor, or wait.'
    case 'RATE_LIMITED':
      return 'Too many codes requested for this email. Wait before trying again.'
    case 'RESEND_TOO_SOON':
      return 'Wait a little longer before requesting another code.'
    default:
      return e.message
  }
}

/**
 * v2 sign-in (Yassine, 3 Nov): email step, code step with resend countdown,
 * desk selector. Replaces the brief's password step with the Lionston-style
 * email code; screens otherwise follow the sign-in help article (card,
 * desk selector, error states). Part 8, first UI commit — lock screen and
 * connection-lost are separate components.
 */
export function SignInScreen() {
  const store = useStore()
  const now = useNow()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [operator, setOperator] = useState<AuthOperator | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendAt, setResendAt] = useState<number | null>(null)

  const resendInSec = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0

  async function submitEmail() {
    if (!email.trim()) {
      setError({ code: 'NOT_FOUND', message: 'Enter your operator ID or email.' })
      return
    }
    setBusy(true)
    const r = await store.requestCode(email.trim())
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setResendAt(Date.now() + r.value.resendAfterSec * 1000)
    setStep('code')
  }

  async function resend() {
    if (resendInSec > 0 || busy) return
    setBusy(true)
    const r = await store.requestCode(email.trim())
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setResendAt(Date.now() + r.value.resendAfterSec * 1000)
  }

  async function submitCode() {
    if (code.length !== OTP_CODE_LENGTH) {
      // Local validation, never sent to the mock — NOT_FOUND here only
      // picks errorText's generic e.message fallback, not a real "not found".
      setError({ code: 'NOT_FOUND', message: 'Enter the 6-digit code.' })
      return
    }
    setBusy(true)
    const r = await store.verifyCode(email.trim(), code)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setOperator(r.value.operator)
    setStep('desk')
  }

  async function pickDesk(deskId: number) {
    if (!operator) return
    setBusy(true)
    const r = await store.selectDesk(deskId, operator)
    setBusy(false)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="signin" role="main" aria-labelledby="signin-t">
      <div className="signin-card">
        <h1 id="signin-t">Sign in</h1>

        {step === 'email' && (
          <>
            <p className="signin-sub">Enter your operator ID or work email. We'll send you a 6-digit code.</p>
            <label className="signin-label" htmlFor="signin-email">Operator ID or email</label>
            <input
              id="signin-email"
              className="signin-input"
              placeholder="OP-214 or you@example.com"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submitEmail()}
            />
            {error && <p className="signin-err" role="alert">{errorText(error)}</p>}
            <button className="btn primary" disabled={busy} onClick={() => void submitEmail()}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <p className="signin-sub">Enter the 6-digit code sent to <b>{email}</b>.</p>
            <label className="signin-label" htmlFor="signin-code">Code</label>
            <input
              id="signin-code"
              className="signin-input mono"
              placeholder="123456"
              inputMode="numeric"
              maxLength={OTP_CODE_LENGTH}
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void submitCode()}
            />
            {error && <p className="signin-err" role="alert">{errorText(error)}</p>}
            <button className="btn primary" disabled={busy} onClick={() => void submitCode()}>
              {busy ? 'Checking…' : 'Verify'}
            </button>
            <div className="signin-row">
              <button className="btn sm" disabled={resendInSec > 0 || busy} onClick={() => void resend()}>
                {resendInSec > 0 ? `Resend in ${resendInSec}s` : 'Resend code'}
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setError(null)
                }}
              >
                Use a different email
              </button>
            </div>
          </>
        )}

        {step === 'desk' && operator && (
          <>
            <p className="signin-sub">Welcome, {operator.name}. Choose your desk.</p>
            <div className="signin-row">
              {operator.desks.map((d) => (
                <button key={d} className="btn" disabled={busy} onClick={() => void pickDesk(d)}>
                  Desk {d}
                </button>
              ))}
            </div>
            {error && <p className="signin-err" role="alert">{errorText(error)}</p>}
          </>
        )}
      </div>
    </div>
  )
}
