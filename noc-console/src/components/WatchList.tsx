import { useState } from 'react'
import type { Snapshot, WatchScore } from '../api/types'

/** Three levels, not the mockup's four — the lowest two were indistinguishable
 * from the track and from each other (audit B11). */
function hourLevel(hour: number, peak: number[]): 'peak' | 'near' | 'track' {
  if (peak.includes(hour)) return 'peak'
  if (peak.some((p) => Math.abs(p - hour) === 1 || Math.abs(p - hour) === 23)) return 'near'
  return 'track'
}

function HourStrip({ peak }: { peak: number[] }) {
  return (
    <div className="hours" aria-hidden="true">
      {Array.from({ length: 24 }, (_, h) => (
        <i key={h} className={hourLevel(h, peak)} />
      ))}
    </div>
  )
}

function WatchRow({ w, siteName, defaultOpen }: { w: WatchScore; siteName: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const trendBand = w.trend > 0 ? w.band : 'lo'
  return (
    <div className={`wrow ${open ? 'open' : ''}`}>
      <button className="wrow-h" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`wscore band-${w.band} mono`}>{w.score}</span>
        <span className="wmeta">
          <b>{siteName}</b>
          <em>Cam {w.cameraId} · {w.eventCount} events</em>
        </span>
        <span className={`wtrend band-${trendBand} mono`}>{w.trend > 0 ? '+' : ''}{w.trend}</span>
      </button>
      <div className="wbar"><i className={`fill-${w.band}`} style={{ width: `${w.score}%` }} /></div>
      {open && (
        <div className="wdetail">
          {w.signals.map((s, i) => (
            <div className="wsig" key={`${s.when}-${i}`}>
              <u className="mono">{s.count}×</u>
              <span>{s.text}<em>{s.when}</em></span>
            </div>
          ))}
          <HourStrip peak={w.peakHours} />
          <div className="hlabel"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          <div className="wcluster">Cluster · {w.clusterWindow ?? 'no cluster'}</div>
          <p className="wnote">{w.note}</p>
        </div>
      )}
    </div>
  )
}

export function WatchList({ server }: { server: Snapshot }) {
  return (
    <section className="watch-region" aria-labelledby="h-watch">
      <h2 className="hd" id="h-watch">Watch list · 7 days</h2>
      <div className="region-body watch-body">
        {server.watch.length ? (
          server.watch.map((w, i) => (
            <WatchRow
              key={w.siteId}
              w={w}
              siteName={server.sites.find((s) => s.id === w.siteId)?.name ?? w.siteId}
              defaultOpen={i === 0}
            />
          ))
        ) : (
          <p className="empty">No sites on watch.</p>
        )}
      </div>
    </section>
  )
}
