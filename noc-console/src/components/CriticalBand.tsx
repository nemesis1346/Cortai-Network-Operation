import type { Snapshot } from '../api/types'
import { activePage } from '../store/selectors'
import { useStore } from '../store/context'

/** Highest severity state on screen (audit A3). Persists until acknowledged. */
export function CriticalBand({ server }: { server: Snapshot }) {
  const store = useStore()
  const page = activePage(server)
  if (!page) return null
  const t = new Date(page.pagedAt)
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return (
    <div className="critical-band" role="alert" aria-live="assertive">
      <span aria-hidden="true">■</span>
      <span>
        <b>Desk {page.desk} paged</b> at {hhmm} · {page.reason}
      </span>
      <button className="btn" onClick={() => void store.acknowledgePage(page.desk)}>Acknowledge</button>
    </div>
  )
}
