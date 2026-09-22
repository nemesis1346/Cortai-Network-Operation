import type { Alert, AlertState, Snapshot } from '../api/types'
import { laneLetter } from '../domain/rules'
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

function QueueRow({ alert, lane }: { alert: Alert; lane: string | null }) {
  const store = useStore()
  return (
    <button
      className={`row p${alert.priority} ${lane ? 'live' : ''} ${alert.priority === 3 ? 'muted' : ''}`}
      onClick={() => void store.openIncident(alert.id)}
    >
      <div className="row-t">
        <b>{alert.title}</b>
        <AgeTag raisedAt={alert.raisedAt} />
      </div>
      <p>Cam {alert.cameraId} · {alert.chips[0] ?? ''}</p>
      {lane && <span className="lanetag">Lane {lane}</span>}
    </button>
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
