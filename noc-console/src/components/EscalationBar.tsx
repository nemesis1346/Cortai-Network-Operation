import type { Snapshot } from '../api/types'
import { UNATTENDED_ALARM_SEC } from '../domain/constants'
import { escalationTier, laneLetter } from '../domain/rules'
import { fmtClock, unattendedStreakSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { activePage, mostEscalatedIncident } from '../store/selectors'

/**
 * Desk-level alarm under the top bar (v2 COMPONENTS.md#EscalationBar). Only
 * one bar at a time: an incident actively escalating (45s+ unattended) always
 * wins the slot; a manual desk page with no specific lane driving it (e.g.
 * "Page second desk" from the lane-limit refusal) is the fallback, so a
 * dispatched page is never silently forgotten once its lane is acknowledged.
 * Supersedes the old CriticalBand, which only ever showed the fallback case.
 */
export function EscalationBar({ server }: { server: Snapshot }) {
  const store = useStore()
  const now = useNow()

  const inc = mostEscalatedIncident(server, now)
  if (inc) {
    const streak = unattendedStreakSec(inc, now)
    const tier = escalationTier(streak) // never 'none' — mostEscalatedIncident already filters that out
    const site = server.sites.find((s) => s.id === inc.siteId)
    const alert = server.alerts.find((a) => a.id === inc.alertId)
    const letter = laneLetter(inc)
    const toPage = Math.max(0, UNATTENDED_ALARM_SEC - streak)
    return (
      <div className={`escalation-band ${tier}`} role="alert" aria-live="assertive">
        <span aria-hidden="true">■</span>
        <span>
          <b>Lane {letter} unattended</b> · {site?.name ?? inc.siteId} · {alert?.title ?? ''} ·{' '}
          {tier === 'warning'
            ? `Supervisor is paged in ${toPage}s unless you look at the lane`
            : `Supervisor paged · unattended ${fmtClock(streak)}`}
        </span>
        <button className="btn" onClick={() => void store.requestFocus(inc.id)}>
          Open lane {letter} <kbd>{letter}</kbd>
        </button>
        <button className="btn" onClick={() => void store.acknowledgeEscalation(inc.id)}>
          Acknowledge <kbd>K</kbd>
        </button>
      </div>
    )
  }

  const page = activePage(server)
  if (!page) return null
  const t = new Date(page.pagedAt)
  const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return (
    <div className="escalation-band critical" role="alert" aria-live="assertive">
      <span aria-hidden="true">■</span>
      <span>
        <b>Desk {page.desk} paged</b> at {hhmm} · {page.reason}
      </span>
      <button className="btn" onClick={() => void store.acknowledgePage(page.desk)}>Acknowledge</button>
    </div>
  )
}
