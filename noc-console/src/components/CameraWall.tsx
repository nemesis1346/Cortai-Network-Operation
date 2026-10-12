import { useEffect } from 'react'
import type { Camera, CameraStatus, Snapshot } from '../api/types'
import { laneLetter } from '../domain/rules'
import { useStore, useUi } from '../store/context'
import { camerasForWall, cameraSummary } from '../store/selectors'

const WALL_TABS: { id: 'all' | CameraStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'motion', label: 'Motion' },
  { id: 'fault', label: 'Fault' },
  { id: 'offline', label: 'Offline' },
]

/**
 * v2 COMPONENTS.md#CameraTile. A tile for a camera an open lane owns jumps to
 * that lane — the wall never shows a second, competing view of a camera
 * someone is already working (deviations#13). A tile with no owning lane
 * would open v2's standalone "camera view" (new-in-v2, Part 7) — that screen
 * doesn't exist yet, so this says so instead of a dead click.
 */
function CameraTile({ camera, server }: { camera: Camera; server: Snapshot }) {
  const store = useStore()
  const inc = server.incidents.find((i) => i.cameraId === camera.id)
  const siteName = server.sites.find((s) => s.id === camera.siteId)?.name ?? camera.siteId

  const open = () => {
    if (inc) {
      void store.requestFocus(inc.id)
      store.toggleWall()
      return
    }
    store.toast(`Cam ${camera.id} has no open incident — camera view isn't built yet.`, 'info')
  }

  return (
    <button className="tile" onClick={open}>
      <div className="video-slot-fallback" aria-hidden="true" />
      <span className={`tile-dot ${camera.status}`} aria-hidden="true" />
      {inc && <span className="tile-lane">Lane {laneLetter(inc)}</span>}
      <div className="tile-l">
        <span>{camera.id} · {camera.name}</span>
        <span>{siteName}</span>
      </div>
    </button>
  )
}

/**
 * v2 deviations#13: replaces the old CameraRibbon's motion-only wall-overlay.
 * Always available, including with incidents open — see `store.ts#toggleWall`
 * for why that's safe. Status tabs with counts, "Order: motion, fault,
 * offline, then live" on All (`store/selectors.ts#camerasForWall`).
 */
export function CameraWall({ server }: { server: Snapshot }) {
  const store = useStore()
  const ui = useUi()
  const counts = cameraSummary(server)
  const cams = camerasForWall(server, ui.wallFilter)

  useEffect(() => {
    if (!ui.wallOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.toggleWall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.wallOpen, store])

  return (
    <section className="cams-region" aria-labelledby="h-cams">
      <div className="cams-head">
        <h2 className="hd" id="h-cams">Cameras</h2>
        <button className="btn wall-toggle" onClick={() => store.toggleWall()}>
          {ui.wallOpen ? 'Collapse wall' : 'Expand wall'} <kbd>W</kbd>
        </button>
      </div>

      {ui.wallOpen && (
        <div className="wall-overlay" role="dialog" aria-label="Camera wall">
          <div className="wall-head">
            <b>Camera wall</b>
            <div className="seg" role="radiogroup" aria-label="Filter by status">
              {WALL_TABS.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={ui.wallFilter === t.id}
                  className="seg-opt"
                  onClick={() => store.setWallFilter(t.id)}
                >
                  {t.label} <span className="tab-n">{t.id === 'all' ? counts.total : counts[t.id]}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => store.toggleWall()}>Close</button>
          </div>
          {cams.length ? (
            <div className="wall-grid">
              {cams.map((c) => (
                <CameraTile key={c.id} camera={c} server={server} />
              ))}
            </div>
          ) : (
            <p className="empty">No cameras in this view.</p>
          )}
        </div>
      )}
    </section>
  )
}
