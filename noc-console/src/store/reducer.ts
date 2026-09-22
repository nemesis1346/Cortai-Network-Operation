import type { ServerEvent, Snapshot } from '../api/types'

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

/** Pure: server state + event -> new server state. Same path for mock ticker and WebSocket. */
export function applyEvent(s: Snapshot, e: ServerEvent): Snapshot {
  switch (e.type) {
    case 'alert.upsert':
      return { ...s, alerts: upsert(s.alerts, e.alert) }
    case 'incident.upsert':
      return { ...s, incidents: upsert(s.incidents, e.incident) }
    case 'incident.closed':
      return { ...s, incidents: s.incidents.filter((i) => i.id !== e.incidentId), stats: e.stats }
    case 'ladder.updated':
      return {
        ...s,
        incidents: s.incidents.map((i) => (i.id === e.ladder.incidentId ? { ...i, ladder: e.ladder } : i)),
      }
    case 'ledger.added':
      return { ...s, ledger: [...s.ledger, e.event] }
    case 'evidence.added':
      return { ...s, evidence: [...s.evidence, e.still] }
    case 'transcript.added':
      return { ...s, transcript: [...s.transcript, e.line] }
    case 'camera.updated':
      return { ...s, cameras: s.cameras.map((c) => (c.id === e.camera.id ? e.camera : c)) }
    case 'watch.updated':
      return { ...s, watch: s.watch.map((w) => (w.siteId === e.watch.siteId ? e.watch : w)) }
    case 'focus.changed':
      return { ...s, focusIncidentId: e.incidentId }
    case 'mic.changed':
      return { ...s, micOwnerIncidentId: e.incidentId }
    case 'speaker.changed':
      return { ...s, speaker: e.speaker }
    case 'desk.paged':
      return { ...s, pages: [...s.pages, e.page] }
    case 'desk.page.acknowledged':
      return {
        ...s,
        pages: s.pages.map((p) => (p.desk === e.desk && !p.acknowledgedAt ? { ...p, acknowledgedAt: e.at } : p)),
      }
  }
}
