import { useEffect, useRef, useState } from 'react'
import type { NextStepId } from '../api/types'
import { MEMO_MIN_LENGTH } from '../domain/constants'
import { laneLetter } from '../domain/rules'
import { attendedSec, fmtClock, incidentAgeSec, unattendedSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useServer, useStore, useUi } from '../store/context'

const STEPS: { id: NextStepId; label: string; hint: string }[] = [
  { id: 'report', label: 'Create incident report', hint: 'Compiles stills, transcript, ledger and timings into a PDF' },
  { id: 'police', label: 'Forward to police', hint: 'Report plus plate and clip sent to the local detachment' },
  { id: 'owner', label: 'Notify site owner / tenants', hint: 'Summary emailed to the site contact list in the morning' },
  { id: 'plate', label: 'Add plate to watch list', hint: 'Future sightings raise priority automatically' },
  { id: 'patrol', label: 'Request patrol pass', hint: "Adds a drive-by to tonight's mobile route" },
  { id: 'tune', label: 'Flag detection as not useful', hint: 'Feeds the zone threshold retraining queue' },
]

/**
 * Requires a memo (min length shown from the moment the dialog opens, not
 * after a refusal — audit C6/A14), Esc keeps it open with a confirm if text
 * was entered instead of doing nothing, and traps Tab instead of leaking
 * focus to the page behind it.
 */
export function CloseoutModal() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()
  const now = useNow()
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [memo, setMemo] = useState('')
  const [steps, setSteps] = useState<NextStepId[]>(['report'])
  const [showError, setShowError] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const inc = server?.incidents.find((i) => i.id === ui.closingIncidentId) ?? null

  useEffect(() => {
    if (!ui.closingIncidentId) return
    setMemo('')
    setSteps(['report'])
    setShowError(false)
    setConfirmDiscard(false)
    const t = setTimeout(() => memoRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [ui.closingIncidentId])

  // In-app confirm, not window.confirm() — a native dialog blocks the whole
  // page, including other lanes' ladder countdowns (the same problem audit
  // C7 flagged for the mic hand-off; this modal shouldn't reintroduce it).
  const keepOpen = () => {
    if (memo.trim().length > 0) {
      setConfirmDiscard(true)
      return
    }
    store.cancelCloseout()
  }

  useEffect(() => {
    if (!ui.closingIncidentId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (confirmDiscard) setConfirmDiscard(false)
        else keepOpen()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, input, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables.length) return
      const list = Array.from(focusables)
      const first = list[0]!
      const last = list[list.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // keepOpen closes over `memo`, which changes every keystroke — reattaching per keystroke is fine, it's one listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.closingIncidentId, memo, confirmDiscard])

  if (!server || !inc) return null

  const site = server.sites.find((s) => s.id === inc.siteId)
  const toggleStep = (id: NextStepId) =>
    setSteps((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async () => {
    if (memo.trim().length < MEMO_MIN_LENGTH) {
      setShowError(true)
      return
    }
    await store.submitCloseout(memo, steps)
  }

  const evidenceCount = server.evidence.filter((e) => e.incidentId === inc.id).length
  const notesCount = server.ledger.filter((e) => e.incidentId === inc.id && e.kind === 'note').length
  const remaining = Math.max(0, MEMO_MIN_LENGTH - memo.trim().length)

  return (
    <>
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="co-title" ref={dialogRef}>
        <div className="modal-head">
          <b id="co-title">Close incident · lane {laneLetter(inc)} · {site?.name ?? inc.siteId}</b>
          <button className="modal-x" aria-label="Keep open" onClick={keepOpen}>✕</button>
        </div>

        <div className="modal-body">
          <label className={`memo-label ${showError ? 'bad' : ''}`} htmlFor="co-memo">
            <span>Operator memo · required</span>
            <span className="memo-count">{memo.trim().length} / {MEMO_MIN_LENGTH} characters minimum</span>
          </label>
          <textarea
            id="co-memo"
            ref={memoRef}
            className={`memo-field ${showError ? 'bad' : ''}`}
            rows={4}
            value={memo}
            onChange={(e) => {
              setMemo(e.target.value)
              if (showError) setShowError(false)
            }}
          />
          {showError && (
            <p className="memo-error" role="alert">Memo required before close — {remaining} more characters needed.</p>
          )}

          <div className="steps-head"><span>Next steps</span><em>Optional — none are required to close</em></div>
          <div className="steps">
            {STEPS.map((s) => (
              <label className={`step ${steps.includes(s.id) ? 'on' : ''}`} key={s.id}>
                <input type="checkbox" checked={steps.includes(s.id)} onChange={() => toggleStep(s.id)} />
                <span className="bx" aria-hidden="true" />
                <span><b>{s.label}</b><em>{s.hint}</em></span>
              </label>
            ))}
          </div>

          <div className="recap">
            <div><span>Duration</span><b className="mono">{fmtClock(incidentAgeSec(inc, now))}</b></div>
            <div><span>Attended / unattended</span>
              <b className="mono">{fmtClock(attendedSec(inc, now))} / {fmtClock(unattendedSec(inc, now))}</b></div>
            <div><span>Operator visits</span><b className="mono">{inc.visits}</b></div>
            <div><span>Voice stages played</span><b className="mono">{inc.ladder.firedStage + 1} of 4</b></div>
            <div><span>Stills captured</span><b className="mono">{evidenceCount}</b></div>
            <div><span>Notes filed</span><b className="mono">{notesCount}</b></div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={keepOpen}>Keep open</button>
          <button className="btn primary" onClick={() => void submit()}>Record and close</button>
        </div>
      </div>
    </div>
    {confirmDiscard && (
      <div className="modal-backdrop">
        <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="discard-title">
          <p id="discard-title">Discard this memo and keep the incident open?</p>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDiscard(false)}>Cancel</button>
            <button
              className="btn primary"
              onClick={() => {
                setConfirmDiscard(false)
                store.cancelCloseout()
              }}
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
