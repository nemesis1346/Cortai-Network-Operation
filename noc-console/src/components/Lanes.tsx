import type { Snapshot } from '../api/types'
import { incidentsByLane } from '../store/selectors'
import { LaneWorkspace } from './LaneWorkspace'

/**
 * One focused Lane Workspace fills the centre (v2 interaction model, replacing
 * the mockup's 1/2/2+mini grid — see docs/V2-BUILD-PLAN.md Part 1). Other open
 * lanes render in the right rail via PeripheralLanes, not here.
 */
export function Lanes({ server }: { server: Snapshot }) {
  const lanes = incidentsByLane(server)

  if (!lanes.length) {
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
  const focused = lanes.find((l) => l.id === focusId) ?? lanes[0]!
  const alert = server.alerts.find((a) => a.id === focused.alertId)
  if (!alert) return null

  // key=inc.id: without it, LaneWorkspace's local state (note draft, which
  // watch tab is open, hold-to-talk/arm press state) survives a lane switch
  // instead of resetting — a real latent bug since Part 1, now more visible
  // with more local state added. Force a remount per incident instead.
  return <LaneWorkspace key={focused.id} inc={focused} alert={alert} server={server} />
}
