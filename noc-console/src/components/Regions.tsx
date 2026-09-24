import type { ReactNode } from 'react'
import type { Snapshot } from '../api/types'
import { CameraRibbon } from './CameraRibbon'
import { EstateTree } from './EstateTree'
import { LaneActivity } from './LaneActivity'
import { Lanes } from './Lanes'
import { Queue } from './Queue'
import { WatchList } from './WatchList'

/** Named landmark with an h2, so headings are real markup (audit B5). */
function Region({ id, title, children, className }: { id: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <section className={className} aria-labelledby={id}>
      <h2 className="hd" id={id}>{title}</h2>
      <div className="region-body">{children ?? <p className="empty">Not built yet.</p>}</div>
    </section>
  )
}

// Voice-strip content is still a placeholder, replaced next.
export const LeftRail = ({ server }: { server: Snapshot }) => (
  <aside className="col rail-l" aria-label="Estate and watch list">
    <EstateTree server={server} />
    <WatchList server={server} />
  </aside>
)

export const Center = ({ server }: { server: Snapshot }) => (
  <main className="col center" aria-label="Incidents">
    <Lanes server={server} />
    <CameraRibbon server={server} />
  </main>
)

export const RightRail = ({ server }: { server: Snapshot }) => (
  <aside className="col rail-r" aria-label="Queue and lane activity">
    <Queue server={server} />
    <LaneActivity server={server} />
  </aside>
)

export const VoiceStrip = () => (
  <footer className="voice" aria-label="Voice channel">
    <Region id="h-voice" title="Voice" />
  </footer>
)
