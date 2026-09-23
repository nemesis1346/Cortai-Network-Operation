import type { Alert, Camera, Incident, LedgerEvent, Site, Snapshot, WatchScore } from '../api/types'
import { sortAlerts } from '../domain/rules'

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

export const cameraSummary = (s: Snapshot) => {
  const down = s.cameras.filter((c) => c.status === 'down').length
  const motion = s.cameras.filter((c) => c.status === 'motion').length
  return { total: s.cameras.length, live: s.cameras.length - down, motion, down }
}

/** Unacknowledged desk page, drives the critical band (audit A3). */
export const activePage = (s: Snapshot) => s.pages.find((p) => !p.acknowledgedAt)

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
