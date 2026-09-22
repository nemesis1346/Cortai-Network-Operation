import type { ReactNode } from 'react'
import type { Snapshot } from '../api/types'
import { Lanes } from './Lanes'
import { Queue } from './Queue'

/** Named landmark with an h2, so headings are real markup (audit B5). */
function Region({ id, title, children, className }: { id: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <section className={className} aria-labelledby={id}>
      <h2 className="hd" id={id}>{title}</h2>
      <div className="region-body">{children ?? <p className="empty">Not built yet.</p>}</div>
    </section>
  )
}

// LeftRail and voice-strip content are placeholders, replaced in the next steps.
export const LeftRail = () => (
  <aside className="col rail-l" aria-label="Estate and watch list">
    <Region id="h-estate" title="Estate" />
    <Region id="h-watch" title="Watch list · 7 days" />
  </aside>
)

export const Center = ({ server }: { server: Snapshot }) => (
  <main className="col center" aria-label="Incidents">
    <Lanes server={server} />
    <Region id="h-cams" title="Cameras" />
  </main>
)

export const RightRail = ({ server }: { server: Snapshot }) => (
  <aside className="col rail-r" aria-label="Queue and lane activity">
    <Queue server={server} />
    <Region id="h-activity" title="Lane activity" />
  </aside>
)

export const VoiceStrip = () => (
  <footer className="voice" aria-label="Voice channel">
    <Region id="h-voice" title="Voice" />
  </footer>
)
