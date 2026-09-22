import type { Snapshot } from '../api/types'
import { incidentsByLane } from '../store/selectors'
import { Lane } from './Lane'

/**
 * Geometry bound to focus, not to array order (audit C3/C4/A12): with three
 * lanes open, the focused one always takes the wide "focus" grid area and the
 * two others share the "mini" row, whichever lane that happens to be.
 */
export function Lanes({ server }: { server: Snapshot }) {
  const lanes = incidentsByLane(server)
  const count = lanes.length

  if (count === 0) {
    return (
      <div className="lanes count-0">
        <div className="lanes-empty">
          <h3>Queue is clear</h3>
          <p>Take an alert from the queue to open a lane.</p>
        </div>
      </div>
    )
  }

  const focusId = server.focusIncidentId ?? lanes[0]!.id
  const minis = lanes.filter((l) => l.id !== focusId)

  return (
    <div className={`lanes count-${count}`}>
      {lanes.map((inc) => {
        const alert = server.alerts.find((a) => a.id === inc.alertId)
        if (!alert) return null
        const isFocus = inc.id === focusId
        const gridArea = count === 3 ? (isFocus ? 'focus' : minis[0]?.id === inc.id ? 'mini1' : 'mini2') : undefined
        return (
          <Lane
            key={inc.id}
            inc={inc}
            alert={alert}
            server={server}
            focused={server.focusIncidentId === inc.id}
            mini={count === 3 && !isFocus}
            gridArea={gridArea}
          />
        )
      })}
    </div>
  )
}
