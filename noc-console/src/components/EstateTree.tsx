import { useState } from 'react'
import type { Snapshot } from '../api/types'

/**
 * Status is a shape as well as a colour (audit B10: a 5px dot was the only
 * cue, and red/green converge under deuteranopia — exactly camera-down vs
 * camera-healthy). Screen readers get the word via the sr-only span.
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
