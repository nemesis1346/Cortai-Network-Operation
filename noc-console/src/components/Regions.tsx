import type { ReactNode } from 'react'

/** Named landmark with an h2, so headings are real markup (audit B5). */
function Region({ id, title, children, className }: { id: string; title: string; children?: ReactNode; className?: string }) {
  return (
    <section className={className} aria-labelledby={id}>
      <h2 className="hd" id={id}>{title}</h2>
      <div className="region-body">{children ?? <p className="empty">Not built yet.</p>}</div>
    </section>
  )
}

// Placeholders, each replaced by its real component in the next steps.
export const LeftRail = () => (
  <aside className="col rail-l" aria-label="Estate and watch list">
    <Region id="h-estate" title="Estate" />
    <Region id="h-watch" title="Watch list · 7 days" />
  </aside>
)
export const Center = () => (
  <main className="col center" aria-label="Incidents">
    <Region id="h-lanes" title="Incident lanes" />
    <Region id="h-cams" title="Cameras" />
  </main>
)
export const RightRail = () => (
  <aside className="col rail-r" aria-label="Queue and lane activity">
    <Region id="h-queue" title="Queue" />
    <Region id="h-activity" title="Lane activity" />
  </aside>
)
export const VoiceStrip = () => (
  <footer className="voice" aria-label="Voice channel">
    <Region id="h-voice" title="Voice" />
  </footer>
)
