import { useEffect, useState } from 'react'
import type { TranscriptSpeaker } from '../api/types'
import { LADDER_STAGES } from '../domain/constants'
import { ledgerKindLabel } from '../domain/rules'
import { fmtClock } from '../domain/timing'
import { useStore, useUi } from '../store/context'

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = { sys: 'System', ai: 'AI', op: 'Operator' }

const TABS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'transcript', label: 'Transcript' },
  { id: 'notes', label: 'Notes' },
  { id: 'operator', label: 'Operator' },
] as const
type TabId = (typeof TABS)[number]['id']

/**
 * Replaces ReportModal (Part 9 decision note #4) — every closed incident now
 * seals one of these, not just closes where a 'report' step was ticked.
 * Tabs match the incident-records help article's table exactly, except no
 * hash and no "viewed by" log (nothing real to hash, single operator) and
 * no Export PDF (out of scope per Yassine, 3 Nov).
 */
export function RecordModal() {
  const store = useStore()
  const ui = useUi()
  const record = ui.record
  const [tab, setTab] = useState<TabId>('evidence')

  useEffect(() => {
    if (record) setTab('evidence')
  }, [record])

  useEffect(() => {
    if (!record) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeRecord()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [record, store])

  if (!record) return null
  const { incident: inc, alert, site, watch, operator, ledger, evidence, transcript } = record

  const duration = ledger.reduce((max, e) => Math.max(max, e.tPlusSec), 0)
  const stages = inc.ladder.firedStage + 1
  const stageName = inc.ladder.firedStage >= 0 ? LADDER_STAGES[inc.ladder.firedStage]?.name : null
  const twoWay = ledger.some((e) => e.text.includes('Two-way'))
  // The closing-memo ledger line duplicates `inc.memo`, shown separately below.
  const notes = ledger.filter((e) => e.kind === 'note' && !e.text.startsWith('Closing memo'))
  const time = (iso: string) => iso.slice(11, 19)

  const copyLink = () => {
    const link = `${location.origin}/records/${inc.id}`
    navigator.clipboard
      .writeText(link)
      .then(() => store.toast('Link copied', 'info'))
      .catch(() => store.toast('Could not copy — clipboard unavailable', 'warn'))
  }

  return (
    <div className="modal-backdrop" onClick={() => store.closeRecord()}>
      <div
        className="modal record"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rec-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b id="rec-title">Record · {site.name} · {alert.title}</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.closeRecord()}>✕</button>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-body record-body">
          {tab === 'evidence' && (
            <>
              <h4>Evidence · {evidence.length} stills</h4>
              {evidence.length ? (
                <ul className="mono-list">
                  {evidence.map((e) => (
                    <li key={e.id}>{time(e.capturedAt)} · T+{e.tPlusSec}s · {e.description}</li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No stills captured.</p>
              )}

              <h4>Subject description</h4>
              {(() => {
                const s = alert.subject
                const hasVehicle = s?.colour && s?.body
                const hasPersons = !!s?.personCount
                if (!hasVehicle && !hasPersons) return <p>No vehicle or person descriptors met the 0.85 threshold.</p>
                return (
                  <p>
                    {hasVehicle && <>Vehicle: {s.colour} {s.body} (confidence {s.vehicleConfidence})<br /></>}
                    {hasPersons && <>Persons: {s.personCount} (confidence {s.personCountConfidence})<br /></>}
                    {s?.where && <>Position: {s.where}</>}
                  </p>
                )
              })()}
            </>
          )}

          {tab === 'timeline' && (
            <div className="ledger">
              {ledger.length ? (
                ledger.map((e) => (
                  <div className={`led ${e.kind}`} key={e.id}>
                    <span className="ts mono">{time(e.at)}</span>
                    <span><i>{ledgerKindLabel(e.kind)}</i>{e.text}</span>
                  </div>
                ))
              ) : (
                <p className="empty">No events.</p>
              )}
            </div>
          )}

          {tab === 'transcript' && (
            <div className="ledger" role="log">
              {transcript.length ? (
                transcript.map((l) => (
                  <div className={`tline ${l.speaker}`} key={l.id}>
                    <span className="ts mono">{time(l.at)}</span>
                    <span className="who">{SPEAKER_LABEL[l.speaker]}</span>
                    <span className="tx">{l.text}</span>
                  </div>
                ))
              ) : (
                <p className="empty">No transcript.</p>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <>
              <h4>Closing memo</h4>
              <p>{inc.memo}</p>

              {notes.length > 0 && (
                <>
                  <h4>Notes during incident</h4>
                  <ul className="mono-list">
                    {notes.map((n) => (
                      <li key={n.id}>{time(n.at)} · {n.text}</li>
                    ))}
                  </ul>
                </>
              )}

              <h4>Next steps queued</h4>
              {inc.nextSteps?.length ? (
                <ul>
                  {inc.nextSteps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p>None queued.</p>
              )}
            </>
          )}

          {tab === 'operator' && (
            <>
              <h4>Handled by</h4>
              <p>
                Operator: {operator.name} · desk {operator.desk}<br />
                Opened: {time(inc.openedAt)}<br />
                Duration: {fmtClock(duration)}<br />
                Attended {fmtClock(inc.attendedSec)} of {fmtClock(duration)} across {inc.visits} visit(s)
              </p>
              {watch && (
                <p>Site watch index at time of incident: {watch.score} {watch.trend > 0 ? '+' : ''}{watch.trend} · night cluster {watch.clusterWindow ?? 'none'}</p>
              )}

              <h4>System response</h4>
              <p>
                Voice ladder: {stages} of 4 stages played{stageName ? ` — through "${stageName}"` : ''}<br />
                Siren: {inc.siren ? 'engaged' : 'not used'} · Strobe: {inc.strobe ? 'engaged' : 'not used'}<br />
                Two-way channel: {twoWay ? 'opened by operator' : 'not opened'}
              </p>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={copyLink}>Copy link</button>
          <button className="btn primary" onClick={() => store.closeRecord()}>Close</button>
        </div>
      </div>
    </div>
  )
}
