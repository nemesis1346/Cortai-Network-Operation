/**
 * Deterministic load fixture (Yassine's point 5, scale check): 48 cameras
 * across 12 sites, 200 alerts in the queue, 3 lanes open, and a burst of
 * server events every second. Everything comes from one seeded PRNG, so the
 * same seed produces the same estate, queue and event stream on every run,
 * and before/after numbers are comparable.
 *
 * Used only when the mock is constructed with `fixture` (VITE_NOC_FIXTURE=load,
 * see main.tsx and docs/PERFORMANCE.md). The normal seed in data.ts is untouched.
 */
import type {
  Alert,
  AlertSeverity,
  Camera,
  CameraStatus,
  EvidenceKind,
  ServerEvent,
  Site,
  Snapshot,
  WatchScore,
} from '../types'

export interface LoadFixtureOptions {
  /** PRNG seed. Same seed, same fixture and same bursts. */
  seed: number
  /** Server events per burst, one burst per mock tick (1 s). */
  burstSize: number
}

export const LOAD_SITES = 12
export const LOAD_CAMERAS_PER_SITE = 4
export const LOAD_ALERTS = 200

/** mulberry32: small, fast, good enough for test data, and deterministic. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!

const STREETS = ['Hope St', 'Rivermede', 'Tait St', 'Courtyard', 'Winhara Rd', 'Mill Ln', 'Quarry Rd', 'Harbour Way', 'Elm Ct', 'Station Rd', 'Kiln St', 'Ferry Rd']
const LOCALITIES = ['Port Hope', 'Cobourg', 'Peterborough', 'Oshawa']
const CAM_NAMES = ['Gate / driveway', 'Rear yard', 'Loading door', 'Unit corridor', 'North stalls', 'Car park', 'Side fence', 'Lobby']
const TITLES: [AlertSeverity, string][] = [
  [1, 'Intruder - person at the fence line'],
  [1, 'Intruder - occupant exited vehicle'],
  [2, 'Person at loading door after hours'],
  [2, 'Vehicle loitering at gate'],
  [3, 'Person photographing gate'],
  [3, 'Delivery detected'],
]
const FACTORS = ['Repeat plate', 'Loiter', 'After hours', 'Door contact', 'Phone raised', 'Watch list site', 'Fence contact']
const CAPTIONS: [string, EvidenceKind][] = [
  ['Subject in frame, full body', 'body'],
  ['Vehicle, plate partly visible', 'plate'],
  ['Face, three-quarter view', 'face'],
  ['Wide shot of the gate', 'scene'],
]

/** Camera ids are 3-digit and start at 100, so they can't collide with the normal seed's 2-digit ones. */
const camId = (site: number, n: number) => String(100 + site * LOAD_CAMERAS_PER_SITE + n)

export function seedLoad(now: number, seed: number): { sites: Site[]; cameras: Camera[]; alerts: Alert[]; watch: WatchScore[] } {
  const r = rng(seed)
  const sites: Site[] = []
  const cameras: Camera[] = []
  const watch: WatchScore[] = []
  for (let s = 0; s < LOAD_SITES; s++) {
    const id = `ls${s}`
    const ids = Array.from({ length: LOAD_CAMERAS_PER_SITE }, (_, n) => camId(s, n))
    sites.push({ id, name: `${10 + s * 7} ${STREETS[s % STREETS.length]}`, locality: pick(r, LOCALITIES), cameraIds: ids })
    ids.forEach((cid, n) => {
      const roll = r()
      const status: CameraStatus = roll < 0.06 ? 'offline' : roll < 0.12 ? 'fault' : roll < 0.3 ? 'motion' : 'live'
      const down = status === 'fault' || status === 'offline'
      cameras.push({
        id: cid, siteId: id, name: CAM_NAMES[(s + n) % CAM_NAMES.length]!, status,
        downSince: down ? new Date(now - Math.floor(r() * 3600_000)).toISOString() : undefined,
        signal: status === 'fault' ? 'degraded' : status === 'offline' ? 'lost' : 'live',
        latencyMs: status === 'offline' ? undefined : 80 + Math.floor(r() * 300),
      })
    })
    const score = Math.floor(r() * 100)
    watch.push({
      siteId: id, cameraId: ids[0]!, score, trend: Math.floor(r() * 40) - 20,
      band: score >= 70 ? 'hi' : score >= 40 ? 'md' : 'lo',
      eventCount: Math.floor(r() * 12), clusterWindow: r() < 0.5 ? '00:40 - 01:30' : null,
      peakHours: [0, 1, 2].filter(() => r() < 0.6),
      signals: [{ count: 1 + Math.floor(r() * 4), text: pick(r, FACTORS), when: 'last 7 days' }],
      note: '',
    })
  }
  const alerts = Array.from({ length: LOAD_ALERTS }, (_, i) => makeAlert(r, now, i, cameras))
  return { sites, cameras, alerts, watch }
}

function makeAlert(r: () => number, now: number, i: number, cameras: Camera[]): Alert {
  const cam = pick(r, cameras.filter((c) => c.status !== 'offline'))
  const [severity, title] = pick(r, TITLES)
  const n = 1 + Math.floor(r() * 3)
  return {
    id: `la${i}`, siteId: cam.siteId, cameraId: cam.id, severity,
    // ~1 in 8 parked, the rest waiting: 200 alerts actually *in the queue*.
    state: r() < 0.125 ? 'held' : 'new',
    title,
    raisedAt: new Date(now - Math.floor(r() * 3 * 3600_000)).toISOString(),
    confidence: Math.round((0.6 + r() * 0.39) * 100) / 100,
    insidePropertyLine: r() < 0.6,
    riskFactors: Array.from({ length: n }, (_, k) => ({
      label: pick(r, FACTORS), weight: k === 0 ? 'high' : k === 1 ? 'medium' : 'low',
    })),
    subject: { where: 'at the gate', personCount: 1 + Math.floor(r() * 2), personCountConfidence: 0.8 },
    detections: [{ label: 'person', confidence: 0.9, box: [0.3 + r() * 0.3, 0.2, 0.2, 0.5] }],
  }
}

/**
 * One second's worth of server traffic against the current snapshot. The mix
 * is weighted toward what a busy estate actually sends most of: camera status
 * churn and queue updates, then lane activity (transcript, ledger, evidence)
 * for the open incidents, then the odd watch-score change.
 */
export function makeBurst(r: () => number, s: Snapshot, size: number, seq: { n: number }): ServerEvent[] {
  const out: ServerEvent[] = []
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const statuses: CameraStatus[] = ['live', 'live', 'live', 'motion', 'fault']
  for (let i = 0; i < size; i++) {
    const roll = r()
    const inc = s.incidents.length ? pick(r, s.incidents) : null
    const tPlusSec = inc ? Math.max(0, Math.floor((nowMs - Date.parse(inc.openedAt)) / 1000)) : 0
    if (roll < 0.35) {
      const cam = pick(r, s.cameras)
      const status = cam.status === 'offline' ? 'offline' : pick(r, statuses)
      out.push({ type: 'camera.updated', camera: { ...cam, status, latencyMs: cam.latencyMs === undefined ? undefined : 80 + Math.floor(r() * 300) } })
    } else if (roll < 0.65) {
      // Re-score a waiting alert (confidence drifts, the AI adds a factor), as
      // a live detector does while a subject is still in frame.
      const waiting = s.alerts.filter((a) => a.state === 'new')
      if (!waiting.length) continue
      const a = pick(r, waiting)
      out.push({ type: 'alert.upsert', alert: { ...a, confidence: Math.round((0.6 + r() * 0.39) * 100) / 100 } })
    } else if (roll < 0.82 && inc) {
      out.push({ type: 'transcript.added', line: { id: `lt${++seq.n}`, at: now, speaker: 'ai', text: 'Subject still at the gate, moving toward the side fence.', incidentId: inc.id } })
    } else if (roll < 0.94 && inc) {
      out.push({ type: 'ledger.added', event: { id: `ll${++seq.n}`, incidentId: inc.id, at: now, kind: 'note', text: 'Auto-note: subject position updated', tPlusSec } })
    } else if (roll < 0.98 && inc) {
      const [description, kind] = pick(r, CAPTIONS)
      out.push({ type: 'evidence.added', still: { id: `le${++seq.n}`, incidentId: inc.id, capturedAt: now, tPlusSec, kind, description, confidence: 0.9, imageUrl: null } })
    } else {
      const w = pick(r, s.watch)
      out.push({ type: 'watch.updated', watch: { ...w, score: Math.max(0, Math.min(100, w.score + Math.floor(r() * 7) - 3)) } })
    }
  }
  return out
}
