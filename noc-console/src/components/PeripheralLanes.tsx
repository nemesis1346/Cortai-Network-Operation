import type { Alert, Incident, Snapshot } from '../api/types'
import { UNATTENDED_ALARM_SEC } from '../domain/constants'
import { attentionLevel, derivePriority, laneLetter } from '../domain/rules'
import { fmtClock, unattendedStreakSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { incidentsByLane } from '../store/selectors'
import { VideoSlot } from './VideoSlot'

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const

/**
 * Peripheral (unfocused) lane with self-escalation (v2 COMPONENTS.md#LaneCard).
 * Live sub-stream thumbnail, priority badge, and an unattended meter that
 * fills toward the 60s auto-page threshold. Hover/focus reveals "Focus this
 * lane · key" in space already reserved below the meter, so revealing it
 * never shifts the card's height.
 */
function LaneCard({ inc, alert }: { inc: Incident; alert: Alert }) {
  const store = useStore()
  const now = useNow()
  const accent = LANE_ACCENT[inc.laneIndex] ?? 'lane-a'
  const streak = unattendedStreakSec(inc, now)
  const attention = attentionLevel(streak)
  const priority = derivePriority(alert)
  const letter = laneLetter(inc)
  const fill = Math.min(1, streak / UNATTENDED_ALARM_SEC) * 100

  return (
    <button
      className={`lane-card ${accent} attn-${attention}`}
      onClick={() => void store.requestFocus(inc.id)}
    >
      <div className="lc-video">
        <VideoSlot cameraId={inc.cameraId} tier="sub" />
      </div>
      <div className="lc-body">
        <div className="lc-head">
          <span className="lane-key">{letter}</span>
          <span className={`pr mono`}>{priority}</span>
          <span className="lc-title">{alert.title}</span>
        </div>
        <span className="lc-time mono">Unattended {fmtClock(streak)}</span>
        <div className="lc-meter"><i style={{ width: `${fill}%` }} /></div>
        <span className="lc-hint">Focus this lane · {letter}</span>
      </div>
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
            return <LaneCard key={inc.id} inc={inc} alert={alert} />
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
