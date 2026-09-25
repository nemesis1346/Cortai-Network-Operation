import { useEffect } from 'react'
import { LADDER_STAGES } from '../domain/constants'
import { fmtClock } from '../domain/timing'
import { useStore, useUi } from '../store/context'

export function ReportModal() {
  const store = useStore()
  const ui = useUi()
  const report = ui.report

  useEffect(() => {
    if (!report) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.closeReport()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [report, store])

  if (!report) return null
  const { incident: inc, alert, site, watch, operator, ledger, evidence } = report

  const duration = ledger.reduce((max, e) => Math.max(max, e.tPlusSec), 0)
  const stages = inc.ladder.firedStage + 1
  const stageName = inc.ladder.firedStage >= 0 ? LADDER_STAGES[inc.ladder.firedStage]?.name : null
  const acts = ledger.filter((e) => e.kind === 'action').slice(0, 10)
  const notes = ledger.filter((e) => e.kind === 'note')
  const twoWay = ledger.some((e) => e.text.includes('Two-way'))
  const time = (iso: string) => iso.slice(11, 19)

  return (
    <div className="modal-backdrop">
      <div className="modal report" role="dialog" aria-modal="true" aria-labelledby="rp-title">
        <div className="modal-head">
          <b id="rp-title">Incident report · {site.name}</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.closeReport()}>✕</button>
        </div>

        <div className="modal-body report-body">
          <h4>Summary</h4>
          <p>
            Site: {site.name}<br />
            Camera: {inc.cameraId}<br />
            Classification: {alert.title}<br />
            Confidence: {alert.confidence ?? '—'}<br />
            Duration: {fmtClock(duration)}<br />
            Operator: {operator.name} · desk {operator.desk}
          </p>
          <p>Attended {fmtClock(inc.attendedSec)} of {fmtClock(duration)} across {inc.visits} visit(s)</p>
          {watch && (
            <p>Site watch index at time of incident: {watch.score} {watch.trend > 0 ? '+' : ''}{watch.trend} · night cluster {watch.clusterWindow ?? 'none'}</p>
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

          <h4>System response</h4>
          <p>
            Voice ladder: {stages} of 4 stages played{stageName ? ` — through "${stageName}"` : ''}<br />
            Siren: {inc.siren ? 'engaged' : 'not used'} · Strobe: {inc.strobe ? 'engaged' : 'not used'}<br />
            Two-way channel: {twoWay ? 'opened by operator' : 'not opened'}
          </p>

          <h4>Evidence · {evidence.length} stills</h4>
          <ul className="mono-list">
            {evidence.slice(0, 8).map((e) => (
              <li key={e.id}>{time(e.capturedAt)} · T+{e.tPlusSec}s · {e.description}</li>
            ))}
          </ul>

          <h4>Operator memo</h4>
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

          <h4>Action log</h4>
          <ul className="mono-list">
            {acts.map((e) => (
              <li key={e.id}>{time(e.at)} · {e.text}</li>
            ))}
          </ul>

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
        </div>

        <div className="modal-foot">
          <button className="btn primary" onClick={() => store.closeReport()}>Close</button>
        </div>
      </div>
    </div>
  )
}
