import { useState } from 'react'
import type { Snapshot } from '../api/types'
import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { cameraSummary } from '../store/selectors'

/**
 * v2 deviations#3: one-row totals (Live / Motion / Fault / Offline)
 * replacing the old camera ribbon's summary line. The Part 3 version of
 * this only had 3 tiles — `CameraStatus` didn't yet distinguish Fault from
 * Offline. Part 4's Camera Wall needed that distinction for its own filter
 * tabs (v2 STATES.md §7), so the type grew a real 4th state and this gets
 * the 4th tile for free. See `docs/API-CONTRACT.md` §13.
 */
function EstateStats({ server }: { server: Snapshot }) {
  const { live, motion, fault, offline } = cameraSummary(server)
  return (
    <div className="estate-stats" role="group" aria-label="Camera status across the estate">
      <div className="estat">
        <span className="estat-dot live" aria-hidden="true" /><b>{live}</b>
        <span>Live</span>
      </div>
      <div className="estat">
        <span className="estat-dot motion" aria-hidden="true" /><b>{motion}</b>
        <span>Motion</span>
      </div>
      <div className="estat">
        <span className="estat-dot fault" aria-hidden="true" /><b>{fault}</b>
        <span>Fault</span>
      </div>
      <div className="estat">
        <span className="estat-dot offline" aria-hidden="true" /><b>{offline}</b>
        <span>Offline</span>
      </div>
    </div>
  )
}

function DownDuration({ since }: { since?: string }) {
  const now = useNow()
  if (!since) return null
  return <span className="cam-down-since mono">{fmtClock(Math.max(0, Math.floor((now - Date.parse(since)) / 1000)))}</span>
}

/**
 * Status is a shape as well as a colour (audit B10: a 5px dot was the only
 * cue, and red/green converge under deuteranopia — exactly camera-down vs
 * camera-healthy). Four shapes now, one per CameraStatus value. Screen
 * readers get the word via the sr-only span. Sole source of per-camera
 * status (v2 deviations#3 — the old ribbon's pip strip duplicated this
 * tree, audit A9); the down-duration the ribbon's fault list used to show
 * lives on the camera's own row instead of being dropped.
 */
export function EstateTree({ server }: { server: Snapshot }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(server.sites.slice(0, 2).map((s) => s.id)))

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="estate-region" aria-labelledby="h-estate">
      <h2 className="hd" id="h-estate">Estate</h2>
      <EstateStats server={server} />
      <div className="region-body estate-body">
        {server.sites.map((site) => {
          const cams = server.cameras.filter((c) => c.siteId === site.id)
          const isOpen = open.has(site.id)
          return (
            <div className="site" key={site.id}>
              <button className="site-h" aria-expanded={isOpen} onClick={() => toggle(site.id)}>
                <span className={`caret ${isOpen ? 'open' : ''}`} aria-hidden="true">▶</span>
                <b>{site.name}</b>
                <em>{cams.length}</em>
              </button>
              {isOpen && (
                <div className="cams">
                  {cams.map((c) => (
                    <div className="cam-row" key={c.id}>
                      <span className={`dot ${c.status}`} aria-hidden="true" />
                      <span className="n">{c.id} · {c.name}</span>
                      {c.masked && <span className="mask-tag">mask</span>}
                      {(c.status === 'fault' || c.status === 'offline') && <DownDuration since={c.downSince} />}
                      <span className="sr-only">{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
