import { useEffect } from 'react'
import type { Snapshot } from '../api/types'
import { useStore, useUi } from '../store/context'

/**
 * v2 deviations#3: the pip strip and fault list used to duplicate the Estate
 * tree (audit A9) — both now live there (`EstateTree.tsx`'s EstateStat row
 * and per-camera down duration). This keeps just the wall toggle + overlay;
 * Part 4 replaces this file outright with the real Camera wall (status
 * tabs, stays open while incidents are open per DECISIONS.md's 5 Oct note).
 */
export function CameraRibbon({ server }: { server: Snapshot }) {
  const store = useStore()
  const ui = useUi()
  const motion = server.cameras.filter((c) => c.status === 'motion')
  const locked = server.incidents.length > 0
  const showWall = ui.wallOpen && !locked

  useEffect(() => {
    if (!showWall) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.toggleWall()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showWall, store])

  const siteTag = (siteId: string) => server.sites.find((s) => s.id === siteId)?.locality ?? siteId

  return (
    <section className="cams-region" aria-labelledby="h-cams">
      <div className="cams-head">
        <h2 className="hd" id="h-cams">Cameras</h2>
        <button className="btn wall-toggle" onClick={() => store.toggleWall()}>
          {locked ? 'Wall locked while incidents open' : ui.wallOpen ? 'Collapse wall' : 'Expand wall'}
        </button>
      </div>

      {showWall && (
        <div className="wall-overlay" role="dialog" aria-label="Camera wall, motion cameras only">
          <div className="wall-head">
            <b>Camera wall · motion only</b>
            <span>showing {motion.length} of {server.cameras.length}</span>
            <button className="btn" onClick={() => store.toggleWall()}>Close</button>
          </div>
          {motion.length ? (
            <div className="wall-grid">
              {motion.map((c) => (
                <div key={c.id} className="tile">
                  <div className="video-slot-fallback" aria-hidden="true" />
                  <span className="tile-badge">Motion</span>
                  <div className="tile-l">
                    <span>{c.id} · {c.name}</span>
                    <span>{siteTag(c.siteId)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">No camera has motion in the last 60s. Nothing is decoding.</p>
          )}
        </div>
      )}
    </section>
  )
}
