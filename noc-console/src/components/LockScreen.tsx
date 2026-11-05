import { useEffect, useState } from 'react'
import type { ApiError } from '../api/types'
import { OTP_CODE_LENGTH } from '../domain/constants'
import { laneLetter } from '../domain/rules'
import { unattendedStreakSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useAuth, useServer, useStore } from '../store/context'
import { alertCounts, incidentsByLane } from '../store/selectors'

function errorText(e: ApiError): string {
  switch (e.code) {
    case 'INVALID_CODE':
      return `That code doesn't match. ${e.attemptsLeft} attempt${e.attemptsLeft === 1 ? '' : 's'} left.`
    case 'CODE_EXPIRED':
      return 'This code has expired. Request a new one.'
    case 'EMAIL_LOCKED':
      return 'Too many wrong codes. This email is locked for a few minutes — ask the desk supervisor, or wait.'
    case 'RATE_LIMITED':
      return 'Too many codes requested. Wait before trying again.'
    case 'RESEND_TOO_SOON':
      return 'Wait a little longer before requesting another code.'
    default:
      return e.message
  }
}

/**
 * v2 lock screen (Yassine, 3 Nov): hides the console while the operator is
 * away; lanes/timers/paging keep running behind it (STATES.md) — the mock
 * server doesn't know or care that the UI is locked, see store.ts#lock.
 * Unlocks with a fresh email code, same requestCode/verifyCode pair sign-in
 * uses (no separate unlock endpoint, DECISIONS.md), skipping straight to the
 * code step since the email is already known from this session.
 */
export function LockScreen() {
  const store = useStore()
  const server = useServer()
  const auth = useAuth()
  const now = useNow()
  const [code, setCode] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [sent, setSent] = useState(false)

  const email = auth.email ?? ''
  const resendInSec = resendAt ? Math.max(0, Math.ceil((resendAt - now) / 1000)) : 0

  async function sendCode() {
    setBusy(true)
    const r = await store.requestCode(email)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    setSent(true)
    setResendAt(Date.now() + r.value.resendAfterSec * 1000)
  }

  // Auto-request a code the moment the screen appears, so the operator
  // doesn't need an extra click just to get started.
  useEffect(() => {
    void sendCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function unlock() {
    if (code.length !== OTP_CODE_LENGTH) {
      setError({ code: 'NOT_FOUND', message: 'Enter the 6-digit code.' })
      return
    }
    setBusy(true)
    const r = await store.verifyCode(email, code)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    store.unlock()
  }

  const lanes = server ? incidentsByLane(server) : []
  const alarmsWaiting = server ? alertCounts(server).new : 0
  const canSignOutAsAnother = lanes.length === 0

  return (
    <div className="signin" role="main" aria-labelledby="lock-t">
      <div className="signin-card">
        <h1 id="lock-t">Console locked</h1>
        <p className="signin-sub">
          {auth.operator ? `${auth.operator.name} · ` : ''}
          {sent ? <>Enter the 6-digit code sent to <b>{email}</b>.</> : 'Sending a fresh code…'}
        </p>

        <label className="signin-label" htmlFor="lock-code">Code</label>
        <input
          id="lock-code"
          className="signin-input mono"
          placeholder="123456"
          inputMode="numeric"
          maxLength={OTP_CODE_LENGTH}
          value={code}
          autoFocus
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void unlock()}
        />
        {error && <p className="signin-err" role="alert">{errorText(error)}</p>}
        <button className="btn primary" disabled={busy} onClick={() => void unlock()}>
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <div className="signin-row">
          <button className="btn sm" disabled={resendInSec > 0 || busy} onClick={() => void sendCode()}>
            {resendInSec > 0 ? `Resend in ${resendInSec}s` : 'Resend code'}
          </button>
          <button
            className="btn sm"
            disabled={!canSignOutAsAnother}
            title={canSignOutAsAnother ? undefined : 'Close or hand off every lane first'}
            onClick={() => void store.signOut()}
          >
            Sign in as another operator
          </button>
        </div>

        {lanes.length > 0 && (
          <div className="lock-away">
            <span className="signin-label">While you're away</span>
            {lanes.map((inc) => (
              <div key={inc.id} className="lock-away-row">
                <span>Lane {laneLetter(inc)}</span>
                <span className="mono">Unattended {Math.floor(unattendedStreakSec(inc, now) / 60)}m</span>
              </div>
            ))}
            <div className="lock-away-row">
              <span>Alarms waiting</span>
              <span className="mono">{alarmsWaiting}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
