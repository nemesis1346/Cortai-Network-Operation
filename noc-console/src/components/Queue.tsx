import type { Alert, AlertState, Snapshot } from '../api/types'
import { derivePriority, laneLetter } from '../domain/rules'
import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore, useUi } from '../store/context'
import { alertCounts, alertsForTab } from '../store/selectors'

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
function QueueRow({ alert, lane }: { alert: Alert; lane: string | null }) {
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
}

export function Queue({ server }: { server: Snapshot }) {
  const store = useStore()
  const ui = useUi()
  const counts = alertCounts(server)
  const rows = alertsForTab(server, ui.queueTab)

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

      {ui.queueRefusal && (
        <div className="refusal" role="alert">
          <span>{ui.queueRefusal}</span>
          <button className="btn" onClick={() => void store.pageSecondDesk()}>Page second desk</button>
          <button className="btn" onClick={() => store.dismissRefusal()}>Dismiss</button>
        </div>
      )}

      <div className="queue-list">
        {rows.length ? (
          rows.map((a) => {
            const inc = server.incidents.find((i) => i.alertId === a.id)
            return <QueueRow key={a.id} alert={a} lane={inc ? laneLetter(inc) : null} />
          })
        ) : (
          <p className="empty">{EMPTY_COPY[ui.queueTab]}</p>
        )}
      </div>
    </section>
  )
}
