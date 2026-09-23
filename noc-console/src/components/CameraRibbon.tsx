import { useEffect } from 'react'
import type { Snapshot } from '../api/types'
import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore, useUi } from '../store/context'

function DownDuration({ since }: { since?: string }) {
  const now = useNow()
  if (!since) return null
  return <span className="mono">{fmtClock(Math.max(0, Math.floor((now - Date.parse(since)) / 1000)))}</span>
}

/**
 * Pips render status as shape, not colour alone (audit B10): circle = live,
 * diamond = motion, square = down. The 8px dot sits in a 24x24 hit area so the
 * click/focus target clears the desk-console minimum (audit B7), and the
 * tooltip opens on focus as well as hover so it's keyboard-reachable (A18).
 */
export function CameraRibbon({ server }: { server: Snapshot }) {
  const store = useStore()
  const ui = useUi()
  const live = server.cameras.filter((c) => c.status !== 'down')
  const motion = server.cameras.filter((c) => c.status === 'motion')
  const down = server.cameras.filter((c) => c.status === 'down')
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
        <span className="cams-sum">{live.length} live · {motion.length} with motion · {down.length} fault</span>
        <button className="btn wall-toggle" onClick={() => store.toggleWall()}>
          {locked ? 'Wall locked while incidents open' : ui.wallOpen ? 'Collapse wall' : 'Expand wall'}
        </button>
      </div>

      <div className="strip" role="list" aria-label="Camera status">
        {server.cameras.map((c) => (
          <span
            key={c.id}
            role="listitem"
            tabIndex={0}
            className={`pip ${c.status}`}
            data-tip={`${c.id} · ${c.name} · ${siteTag(c.siteId)} · ${c.status}`}
          >
            <i />
          </span>
        ))}
      </div>

      {down.length > 0 && (
        <ul className="faults">
          {down.map((c) => (
            <li key={c.id} className="fault">
              <span>{c.id} · {c.name} — no signal</span>
              <DownDuration since={c.downSince} />
            </li>
          ))}
        </ul>
      )}

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
