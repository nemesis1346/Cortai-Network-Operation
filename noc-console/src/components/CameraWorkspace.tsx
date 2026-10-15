import { useEffect, useState } from 'react'
import type { Camera, Snapshot } from '../api/types'
import type { QueuePriority } from '../domain/rules'
import { canOpenIncident } from '../domain/rules'
import { useStore } from '../store/context'
import { VideoSlot } from './VideoSlot'

const PRIORITIES: QueuePriority[] = ['P1', 'P2', 'P3', 'P4']

/**
 * v2 COMPONENTS.md#CameraWorkspace: a camera with no incident behind it,
 * replacing the lane workspace in Center while open (Lanes.tsx checks
 * `ui.viewingCameraId` before falling through to the normal lane logic).
 *
 * Scoped narrower than the full spec on purpose: the spec has speech,
 * deterrents and notes write to a "site log" while viewing, then migrate
 * into the new lane on Raise. Phase 1 has no pre-incident logging surface —
 * CommsDock, useHoldToTalk and setSiren/setStrobe all take an incidentId
 * throughout — and building a parallel no-incident path for them is a real
 * architectural fork, not a small addition. The natural operator flow also
 * raises first, then talks/deters from inside the new lane, which already
 * works. Flagged here, not silently dropped: see `V2-BUILD-PLAN.md`'s Part 7
 * notes for the explicit judgment call.
 */
export function CameraWorkspace({ camera, server }: { camera: Camera; server: Snapshot }) {
  const store = useStore()
  const [priority, setPriority] = useState<QueuePriority>('P3')
  const site = server.sites.find((s) => s.id === camera.siteId)
  const siteCameras = server.cameras.filter((c) => c.siteId === camera.siteId)
  const lanesFull = !canOpenIncident(server.incidents.length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.key === 'Escape') {
        e.preventDefault()
        void store.closeCameraView()
      } else if (e.key.toLowerCase() === 'i' && !lanesFull) {
        e.preventDefault()
        void store.raiseIncident(camera.id, priority)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, camera.id, priority, lanesFull])

  return (
    <article className="workspace camera-workspace" aria-label={`Camera view · Cam ${camera.id}`}>
      <header className="ws-head">
        <div className="ws-head-main">
          <b className="ws-site">{site?.name ?? camera.siteId}</b>
          <span className="ws-summary">Cam {camera.id} · {camera.name}</span>
        </div>
        <button className="btn ws-close-btn" onClick={() => void store.closeCameraView()}>
          Back to lane <kbd>Esc</kbd>
        </button>
      </header>

      <div className="ws-body cw-body">
        <div className="lfeed ws-video">
          <VideoSlot cameraId={camera.id} tier="full" signal={camera.signal} latencyMs={camera.latencyMs} />
          <div className="osd tl">
            <span className="tag mono">CAM {camera.id}</span>
          </div>
        </div>

        {siteCameras.length > 1 && (
          <div className="cw-strip">
            <span className="ev-l">{site?.name ?? camera.siteId} cameras</span>
            <div className="cw-strip-row">
              {siteCameras.map((c) => (
                <button
                  key={c.id}
                  className={`cw-tile ${c.id === camera.id ? 'active' : ''}`}
                  onClick={() => void store.openCameraView(c.id)}
                >
                  <span className={`tile-dot ${c.status}`} aria-hidden="true" />
                  {c.id} · {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="cw-raise">
          <h3 className="ws-sub-h">Raise incident</h3>
          <div className="seg" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={priority === p}
                className="seg-opt"
                onClick={() => setPriority(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            className="btn primary cw-raise-btn"
            disabled={lanesFull}
            onClick={() => void store.raiseIncident(camera.id, priority)}
          >
            Raise incident <kbd>I</kbd>
          </button>
          {lanesFull && <p className="cw-hint">All three lanes are in use. Close or hand off a lane first.</p>}
        </div>
      </div>
    </article>
  )
}
