import type { Alert, Camera, CameraStatus, Incident, LedgerEvent, Site, Snapshot, WatchScore } from '../api/types'
import { escalationTier, sortAlerts } from '../domain/rules'
import { unattendedStreakSec } from '../domain/timing'

export const incidentsByLane = (s: Snapshot): Incident[] =>
  [...s.incidents].sort((a, b) => a.laneIndex - b.laneIndex)

export const alertsForTab = (s: Snapshot, tab: Alert['state']): Alert[] =>
  sortAlerts(s.alerts.filter((a) => a.state === tab), s.watch)

export const alertCounts = (s: Snapshot): Record<'new' | 'working' | 'held', number> => ({
  new: s.alerts.filter((a) => a.state === 'new').length,
  working: s.alerts.filter((a) => a.state === 'working').length,
  held: s.alerts.filter((a) => a.state === 'held').length,
})

export const siteOf = (s: Snapshot, id: string): Site | undefined => s.sites.find((x) => x.id === id)
export const cameraOf = (s: Snapshot, id: string): Camera | undefined => s.cameras.find((x) => x.id === id)
export const watchOf = (s: Snapshot, siteId: string): WatchScore | undefined =>
  s.watch.find((w) => w.siteId === siteId)

/** Exclusive partition by exact status (v2 STATES.md §7) — every camera counts once. */
export const cameraSummary = (s: Snapshot) => {
  const by = (st: CameraStatus) => s.cameras.filter((c) => c.status === st).length
  return {
    total: s.cameras.length,
    live: by('live'),
    motion: by('motion'),
    fault: by('fault'),
    offline: by('offline'),
  }
}

/** v2 COMPONENTS.md#CameraWall: "Order: motion, fault, offline, then live." */
export const CAMERA_WALL_ORDER: CameraStatus[] = ['motion', 'fault', 'offline', 'live']

export function camerasForWall(s: Snapshot, filter: 'all' | CameraStatus): Camera[] {
  const sorted = [...s.cameras].sort(
    (a, b) => CAMERA_WALL_ORDER.indexOf(a.status) - CAMERA_WALL_ORDER.indexOf(b.status),
  )
  return filter === 'all' ? sorted : sorted.filter((c) => c.status === filter)
}

/** Unacknowledged desk page — the EscalationBar's fallback when no specific
 * incident is driving it (e.g. the manual "Page second desk" refusal action). */
export const activePage = (s: Snapshot) => s.pages.find((p) => !p.acknowledgedAt)

/**
 * The one incident the EscalationBar shows (v2 COMPONENTS.md#EscalationBar:
 * "Only one bar at a time"): unacknowledged, at warning tier (45s+) or past,
 * most escalated first so the worst case always wins the single slot.
 */
export function mostEscalatedIncident(s: Snapshot, nowMs: number): Incident | null {
  const candidates = s.incidents
    .filter((i) => !i.escalationAcked && escalationTier(unattendedStreakSec(i, nowMs)) !== 'none')
    .sort((a, b) => unattendedStreakSec(b, nowMs) - unattendedStreakSec(a, nowMs))
  return candidates[0] ?? null
}

export type LedgerGroup = { kind: 'single'; event: LedgerEvent } | { kind: 'stills'; events: LedgerEvent[] }

/**
 * Newest-first, with consecutive 'still' captures collapsed into one row
 * (audit A7: 440 identical "Still captured" rows drowned out everything else).
 */
export function groupLedger(events: LedgerEvent[]): LedgerGroup[] {
  const groups: LedgerGroup[] = []
  let run: LedgerEvent[] = []
  const flushRun = () => {
    if (!run.length) return
    groups.push(run.length > 1 ? { kind: 'stills', events: run } : { kind: 'single', event: run[0]! })
    run = []
  }
  for (const e of [...events].reverse()) {
    if (e.kind === 'still') {
      run.push(e)
      continue
    }
    flushRun()
    groups.push({ kind: 'single', event: e })
  }
  flushRun()
  return groups
}
