import { memo, useMemo } from 'react'
import type { Alert, AlertState, Snapshot } from '../api/types'
import { derivePriority, laneLetter } from '../domain/rules'
import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore, useUi } from '../store/context'
import { alertCounts, alertsForTab } from '../store/selectors'
import type { UiState } from '../store/store'

const TABS: { id: Exclude<AlertState, 'closed'>; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'working', label: 'Working' },
  { id: 'held', label: 'Held' },
]

const EMPTY_COPY: Record<Exclude<AlertState, 'closed'>, string> = {
  new: 'No new alerts — queue clear.',
  working: 'No incidents currently hold a lane.',
  held: 'Nothing held. Auto-logged and suppressed alerts appear here.',
}

/** Isolated so only this tag re-renders each second, not the whole queue. */
function AgeTag({ raisedAt }: { raisedAt: string }) {
  const now = useNow()
  const sec = Math.max(0, Math.floor((now - Date.parse(raisedAt)) / 1000))
  return <span className={`age mono ${sec < 60 ? 'hot' : ''}`}>{fmtClock(sec)}</span>
}

/** A div, not a button: it hosts a real nested "Hold" button, which a <button>
 * can't contain. Taking the alert is still one click, just on a role="button". */
/* Point 5: memoised, so a burst that re-scores a few alerts re-renders those
 * rows, not all ~170. Props are the alert itself (a new object only when that
 * alert changed) and its lane letter. */
const QueueRow = memo(function QueueRow({ alert, lane }: { alert: Alert; lane: string | null }) {
  const store = useStore()
  const priority = derivePriority(alert)
  return (
    <div
      className={`row ${priority.toLowerCase()} ${lane ? 'live' : ''} ${priority === 'P4' ? 'muted' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => void store.openIncident(alert.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void store.openIncident(alert.id)
        }
      }}
    >
      <div className="row-t">
        <span className="pr mono">{priority}</span>
        <b>{alert.title}</b>
        <AgeTag raisedAt={alert.raisedAt} />
      </div>
      <p>Cam {alert.cameraId} · {alert.riskFactors[0]?.label ?? ''}</p>
      <div className="row-foot">
        {lane && <span className="lanetag">Lane {lane}</span>}
        {alert.state === 'new' && (
          <button
            className="btn row-hold"
            onClick={(e) => {
              e.stopPropagation()
              void store.holdAlert(alert.id)
            }}
          >
            Hold
          </button>
        )}
      </div>
    </div>
  )
})

const PRIORITY_FILTERS: { id: UiState['queuePriorityFilter']; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'P1–P2' },
]

export function Queue({ server }: { server: Snapshot }) {
  const store = useStore()
  const ui = useUi()
  // Point 5: sort and count only when alerts or watch scores change, not on
  // every unrelated server event or UI change.
  const counts = useMemo(() => alertCounts(server), [server.alerts])
  const tabRows = useMemo(() => alertsForTab(server, ui.queueTab), [server.alerts, server.watch, ui.queueTab])
  const rows = useMemo(
    () => (ui.queuePriorityFilter === 'high' ? tabRows.filter((a) => derivePriority(a) === 'P1' || derivePriority(a) === 'P2') : tabRows),
    [tabRows, ui.queuePriorityFilter],
  )
  // alertId -> lane letter, built once per change to incidents instead of a
  // find() per row.
  const laneOf = useMemo(() => new Map(server.incidents.map((i) => [i.alertId, laneLetter(i)])), [server.incidents])

  return (
    <section className="queue-region" aria-labelledby="h-queue">
      <h2 className="hd" id="h-queue">Queue</h2>
      <p className="sort-rule">Sorted P1–P4, then watch index, then age (oldest first).</p>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={ui.queueTab === t.id}
            className="tab"
            onClick={() => store.setQueueTab(t.id)}
          >
            {t.label} <span className="tab-n">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <div className="seg" role="radiogroup" aria-label="Filter by priority">
        {PRIORITY_FILTERS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={ui.queuePriorityFilter === f.id}
            className="seg-opt"
            onClick={() => store.setQueuePriorityFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {ui.queueRefusal && (
        <div className="refusal" role="alert">
          <span>{ui.queueRefusal}</span>
          <button className="btn" onClick={() => void store.pageSecondDesk()}>Page second desk</button>
          <button className="btn" onClick={() => store.dismissRefusal()}>Dismiss</button>
        </div>
      )}

      <div className="queue-list">
        {rows.length ? (
          rows.map((a) => <QueueRow key={a.id} alert={a} lane={laneOf.get(a.id) ?? null} />)
        ) : (
          <p className="empty">
            {tabRows.length ? 'No P1–P2 alerts in this tab.' : EMPTY_COPY[ui.queueTab]}
          </p>
        )}
      </div>
    </section>
  )
}
