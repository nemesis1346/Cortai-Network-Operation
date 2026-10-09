import { useState } from 'react'
import type { Snapshot } from '../api/types'
import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { cameraSummary } from '../store/selectors'

/**
 * v2 deviations#3: one-row totals (Live / Motion / Fault) replacing the old
 * camera ribbon's summary line. Figma's EstateStat lists a 4th bucket,
 * Offline, distinct from Fault — our CameraStatus type only has 'live' |
 * 'motion' | 'down', with no signal to tell a true offline camera from a
 * live-but-faulted one. Showing 3 real stats here rather than inventing a
 * 4th that would always read 0; worth raising with Oleg/backend if the
 * distinction matters before integration — see docs/API-CONTRACT.md.
 */
function EstateStats({ server }: { server: Snapshot }) {
  const { live, motion, down } = cameraSummary(server)
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
        <span className="estat-dot down" aria-hidden="true" /><b>{down}</b>
        <span>Fault</span>
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
 * camera-healthy). Screen readers get the word via the sr-only span. Sole
 * source of per-camera status now (v2 deviations#3 — the old ribbon's pip
 * strip duplicated this tree, audit A9); the down-duration the ribbon's
 * fault list used to show lives on the camera's own row instead of being
 * dropped.
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
                      {c.status === 'down' && <DownDuration since={c.downSince} />}
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
