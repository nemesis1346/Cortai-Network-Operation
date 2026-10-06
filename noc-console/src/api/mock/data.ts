import { LADDER_STAGES } from '../../domain/constants'
import type { Alert, Camera, EvidenceKind, ISODate, Site, WatchScore } from '../types'

const ago = (now: number, sec: number): ISODate => new Date(now - sec * 1000).toISOString()

type CamSeed = [id: string, name: string, status: Camera['status'], masked?: boolean]
const SITE_SEEDS: { id: string; name: string; locality: string; cams: CamSeed[]; ladderAtSec?: number[] }[] = [
  { id: 's1', name: '138 Hope St N', locality: 'Port Hope', cams: [['07', 'Gate / driveway', 'motion'], ['08', 'Rear yard', 'live'], ['09', 'Loading door', 'live']] },
  { id: 's2', name: '434 N Rivermede', locality: 'Concord', cams: [['12', 'Loading bay', 'live'], ['19', 'Rear elevation', 'down'], ['20', 'Unit corridor', 'live']] },
  // Faster procedure at this site (repeat-plate pattern on the watch list): overrides
  // the global 0/12/30/45s default. Yassine, 1 Oct: ladder timings come from the site.
  { id: 's3', name: '3 Tait Street', locality: 'Huntsville', cams: [['05', 'Parking', 'motion'], ['06', 'Lobby', 'live']], ladderAtSec: [0, 8, 20, 35] },
  { id: 's4', name: 'Courtyard PS', locality: 'Parry Sound', cams: [['03', 'Porte cochere', 'live'], ['22', 'Corridor L2', 'live', true]] },
  { id: 's5', name: '1496 Winhara Rd', locality: 'Gravenhurst', cams: [['31', 'Compound gate', 'live']] },
]

export function seedEstate(now: number): { sites: Site[]; cameras: Camera[] } {
  const sites: Site[] = []
  const cameras: Camera[] = []
  for (const s of SITE_SEEDS) {
    const ladderStages = s.ladderAtSec?.map((atSec, i) => ({ ...LADDER_STAGES[i]!, atSec }))
    sites.push({ id: s.id, name: s.name, locality: s.locality, cameraIds: s.cams.map((c) => c[0]), ladderStages })
    for (const [id, name, status, masked] of s.cams) {
      cameras.push({
        id, siteId: s.id, name, status, masked,
        downSince: status === 'down' ? ago(now, 298) : undefined,
        // Phase 1 has no real stream: 'live' + a placeholder latency stand in
        // for what go2rtc will report, wired through end to end so the UI
        // has somewhere real to read them from already.
        signal: status === 'down' ? undefined : 'live',
        latencyMs: status === 'down' ? undefined : 120,
      })
    }
  }
  return { sites, cameras }
}

/**
 * Seeded so the three-lane cap can actually be exercised (audit C8):
 * five alerts are 'new'. 'working' is never seeded, it only follows an open incident (audit C5).
 */
export function seedAlerts(now: number): Alert[] {
  return [
    { id: 'a1', siteId: 's1', cameraId: '07', severity: 1, state: 'new', title: 'Intruder - occupant exited vehicle',
      raisedAt: ago(now, 14), confidence: 0.94, insidePropertyLine: true,
      riskFactors: [
        { label: 'Repeat plate · 2 sightings / 7d', weight: 'high' },
        { label: 'Loiter 41s', weight: 'medium' },
        { label: 'After hours', weight: 'low' },
      ],
      subject: { colour: 'white', body: 'sedan', vehicleConfidence: 0.91, where: 'at the gate', personCount: 2, personCountConfidence: 0.93 },
      detections: [{ label: 'person', confidence: 0.94, box: [0.40, 0.20, 0.22, 0.55] }] },
    { id: 'a2', siteId: 's3', cameraId: '05', severity: 1, state: 'new', title: 'Intruder - two on foot at north stalls',
      raisedAt: ago(now, 38), confidence: 0.88, insidePropertyLine: true,
      riskFactors: [
        { label: 'Door handle contact', weight: 'high' },
        { label: 'No vehicle association', weight: 'medium' },
        { label: 'After hours', weight: 'low' },
      ],
      subject: { colour: 'dark', body: 'hatchback', vehicleConfidence: 0.58, where: 'at the north stalls', personCount: 2, personCountConfidence: 0.9 },
      detections: [
        { label: 'person', confidence: 0.88, box: [0.22, 0.30, 0.18, 0.48] },
        { label: 'person', confidence: 0.81, box: [0.58, 0.28, 0.18, 0.50] },
      ] },
    { id: 'a3', siteId: 's2', cameraId: '19', severity: 2, state: 'new', title: 'Camera offline 5 minutes',
      raisedAt: ago(now, 302), confidence: null, insidePropertyLine: false,
      riskFactors: [
        { label: 'Stream lost', weight: 'high' },
        { label: 'PoE port down', weight: 'medium' },
      ],
      suppressedReason: 'No voice channel - camera fault, not a presence event' },
    { id: 'a4', siteId: 's5', cameraId: '31', severity: 2, state: 'new', title: 'Person photographing gate',
      raisedAt: ago(now, 441), confidence: 0.72, insidePropertyLine: false,
      riskFactors: [
        { label: 'Phone raised 9s', weight: 'medium' },
        { label: 'Sidewalk, off-property', weight: 'low' },
      ],
      suppressedReason: 'Subject outside property line - log only, do not address',
      detections: [{ label: 'person', confidence: 0.72, box: [0.56, 0.32, 0.16, 0.42] }] },
    { id: 'a6', siteId: 's1', cameraId: '09', severity: 2, state: 'new', title: 'Person at loading door after hours',
      raisedAt: ago(now, 620), confidence: 0.81, insidePropertyLine: true,
      riskFactors: [
        { label: 'Door contact', weight: 'high' },
        { label: 'After hours', weight: 'low' },
      ],
      subject: { where: 'at the loading door', personCount: 1, personCountConfidence: 0.7 },
      detections: [{ label: 'person', confidence: 0.81, box: [0.44, 0.24, 0.19, 0.52] }] },
    { id: 'a5', siteId: 's4', cameraId: '03', severity: 3, state: 'held', title: 'Delivery detected',
      raisedAt: ago(now, 930), confidence: 0.97, insidePropertyLine: false,
      riskFactors: [
        { label: 'Livery matched', weight: 'medium' },
        { label: 'Auto-logged', weight: 'low' },
      ],
      suppressedReason: 'Delivery signature matched · plate on allow-list',
      detections: [{ label: 'vehicle', confidence: 0.97, box: [0.32, 0.34, 0.34, 0.40] }] },
  ]
}

export function seedWatch(): WatchScore[] {
  return [
    { siteId: 's1', cameraId: '07', score: 78, trend: 31, band: 'hi', eventCount: 6, clusterWindow: '00:40 - 01:30', peakHours: [0, 1],
      signals: [
        { count: 2, text: 'Vehicle slowed, stopped, photo posture', when: 'Tue 01:04 · Fri 01:19 · same plate' },
        { count: 3, text: 'Person at gate pier after midnight', when: 'last 7 days' },
        { count: 1, text: 'Occupant exited vehicle', when: 'tonight' }],
      note: '6 events is a thin sample. A prompt to watch, not a conclusion.' },
    { siteId: 's3', cameraId: '05', score: 63, trend: 22, band: 'hi', eventCount: 14, clusterWindow: '02:00 - 03:15', peakHours: [2, 3],
      signals: [
        { count: 5, text: 'Loiter over 3 min at north stalls', when: 'no vehicle association' },
        { count: 2, text: 'Door handle contact, tenant vehicles', when: 'Sun · Mon' }],
      note: 'Handle contact escalates on its own, whatever the index says.' },
    { siteId: 's5', cameraId: '31', score: 54, trend: 12, band: 'md', eventCount: 9, clusterWindow: '22:00 - 23:30', peakHours: [22, 23],
      signals: [
        { count: 4, text: 'Sidewalk stop facing the gate', when: 'weeknights, off-property' },
        { count: 2, text: 'Phone raised toward compound', when: 'Wed · Sat' }],
      note: 'All events off the property line. Log only.' },
    { siteId: 's2', cameraId: '19', score: 29, trend: -8, band: 'lo', eventCount: 4, clusterWindow: null, peakHours: [],
      signals: [{ count: 3, text: 'Camera dropout, PoE port', when: 'maintenance, not security' }],
      note: 'Score falling after switch replacement.' },
    { siteId: 's4', cameraId: '03', score: 16, trend: -3, band: 'lo', eventCount: 31, clusterWindow: null, peakHours: [],
      signals: [{ count: 28, text: 'Deliveries, allow-listed', when: 'excluded from score' }],
      note: 'High event count, low threat. Allow-list working.' },
  ]
}

/** Cycled by MockNocClient#capture. kind matches v2's EvidenceThumb categories. */
export const STILL_CAPTIONS: { description: string; kind: EvidenceKind }[] = [
  { description: 'Subject in frame, full body, facing camera', kind: 'body' },
  { description: 'Vehicle plate region, enhanced crop', kind: 'plate' },
  { description: 'Subject at property line, gait sequence', kind: 'body' },
  { description: 'Two subjects together, relative height reference', kind: 'body' },
  { description: 'Clothing detail, upper body', kind: 'body' },
  { description: 'Vehicle three-quarter view, rear quarter panel', kind: 'scene' },
  { description: 'Subject reaction to announcement', kind: 'face' },
  { description: 'Departure direction, street heading', kind: 'scene' },
]

export const STAGE_SCRIPT = [
  'Attention. This is private property. You are being recorded and this activity has been reported. Please return to your vehicle and leave.',
  '', // stage 1 is built from the alert's subject descriptors
  'Final warning. Leave the property now. This recording has been transmitted off-site and police have been contacted.',
  'This area remains recorded and monitored.',
]
