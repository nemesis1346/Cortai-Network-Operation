import type { Incident, Snapshot } from '../api/types'
import { laneLetter } from '../domain/rules'
import { fmtClock, unattendedSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { incidentsByLane } from '../store/selectors'

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const

/**
 * Minimal stand-in for the other open lanes while the Lane Workspace owns the
 * centre (Part 1). This is deliberately not yet v2's LaneCard — no unattended
 * meter, no 30/45/60s escalation, no live sub-stream thumbnail. That's Part 2.
 * Exists so 2-3 open incidents still have somewhere to go and a way back to
 * focus, not a placeholder that silently drops them.
 */
function PeripheralRow({ inc, alert }: { inc: Incident; alert: { title: string; siteId: string } }) {
  const store = useStore()
  const now = useNow()
  const accent = LANE_ACCENT[inc.laneIndex] ?? 'lane-a'
  return (
    <button className={`peripheral-row ${accent}`} onClick={() => void store.requestFocus(inc.id)}>
      <span className="lane-key" title={`Focus — key ${laneLetter(inc)}`}>{laneLetter(inc)}</span>
      <span className="peripheral-title">{alert.title}</span>
      <span className="peripheral-time mono">Unattended {fmtClock(unattendedSec(inc, now))}</span>
    </button>
  )
}

export function PeripheralLanes({ server }: { server: Snapshot }) {
  const lanes = incidentsByLane(server)
  const focusId = server.focusIncidentId ?? lanes[0]?.id
  const others = lanes.filter((l) => l.id !== focusId)

  return (
    <section className="peripheral-region" aria-labelledby="h-peripheral">
      <h2 className="hd" id="h-peripheral">Other lanes</h2>
      <div className="region-body peripheral-body">
        {others.length ? (
          others.map((inc) => {
            const alert = server.alerts.find((a) => a.id === inc.alertId)
            if (!alert) return null
            return <PeripheralRow key={inc.id} inc={inc} alert={alert} />
          })
        ) : (
          <p className="empty">
            {lanes.length ? 'No other open incidents.' : 'No incidents open.'}
          </p>
        )}
      </div>
    </section>
  )
}
