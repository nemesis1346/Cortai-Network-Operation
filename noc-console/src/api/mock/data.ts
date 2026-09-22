import type { Alert, Camera, ISODate, Site, WatchScore } from '../types'

const ago = (now: number, sec: number): ISODate => new Date(now - sec * 1000).toISOString()

type CamSeed = [id: string, name: string, status: Camera['status'], masked?: boolean]
const SITE_SEEDS: { id: string; name: string; locality: string; cams: CamSeed[] }[] = [
  { id: 's1', name: '138 Hope St N', locality: 'Port Hope', cams: [['07', 'Gate / driveway', 'motion'], ['08', 'Rear yard', 'live'], ['09', 'Loading door', 'live']] },
  { id: 's2', name: '434 N Rivermede', locality: 'Concord', cams: [['12', 'Loading bay', 'live'], ['19', 'Rear elevation', 'down'], ['20', 'Unit corridor', 'live']] },
  { id: 's3', name: '3 Tait Street', locality: 'Huntsville', cams: [['05', 'Parking', 'motion'], ['06', 'Lobby', 'live']] },
  { id: 's4', name: 'Courtyard PS', locality: 'Parry Sound', cams: [['03', 'Porte cochere', 'live'], ['22', 'Corridor L2', 'live', true]] },
  { id: 's5', name: '1496 Winhara Rd', locality: 'Gravenhurst', cams: [['31', 'Compound gate', 'live']] },
]

export function seedEstate(now: number): { sites: Site[]; cameras: Camera[] } {
  const sites: Site[] = []
  const cameras: Camera[] = []
  for (const s of SITE_SEEDS) {
    sites.push({ id: s.id, name: s.name, locality: s.locality, cameraIds: s.cams.map((c) => c[0]) })
    for (const [id, name, status, masked] of s.cams) {
      cameras.push({
        id, siteId: s.id, name, status, masked,
        downSince: status === 'down' ? ago(now, 298) : undefined,
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
    { id: 'a1', siteId: 's1', cameraId: '07', priority: 1, state: 'new', title: 'Intruder - occupant exited vehicle',
      raisedAt: ago(now, 14), confidence: 0.94, insidePropertyLine: true,
      chips: ['Repeat plate · 2 sightings / 7d', 'Loiter 41s', 'After hours'],
      subject: { colour: 'white', body: 'sedan', vehicleConfidence: 0.91, where: 'at the gate', personCount: 2, personCountConfidence: 0.93 } },
    { id: 'a2', siteId: 's3', cameraId: '05', priority: 1, state: 'new', title: 'Intruder - two on foot at north stalls',
      raisedAt: ago(now, 38), confidence: 0.88, insidePropertyLine: true,
      chips: ['Door handle contact', 'No vehicle association', 'After hours'],
      subject: { colour: 'dark', body: 'hatchback', vehicleConfidence: 0.58, where: 'at the north stalls', personCount: 2, personCountConfidence: 0.9 } },
    { id: 'a3', siteId: 's2', cameraId: '19', priority: 2, state: 'new', title: 'Camera offline 5 minutes',
      raisedAt: ago(now, 302), confidence: null, insidePropertyLine: false,
      chips: ['Stream lost', 'PoE port down'],
      suppressedReason: 'No voice channel - camera fault, not a presence event' },
    { id: 'a4', siteId: 's5', cameraId: '31', priority: 2, state: 'new', title: 'Person photographing gate',
      raisedAt: ago(now, 441), confidence: 0.72, insidePropertyLine: false,
      chips: ['Phone raised 9s', 'Sidewalk, off-property'],
      suppressedReason: 'Subject outside property line - log only, do not address' },
    { id: 'a6', siteId: 's1', cameraId: '09', priority: 2, state: 'new', title: 'Person at loading door after hours',
      raisedAt: ago(now, 620), confidence: 0.81, insidePropertyLine: true,
      chips: ['Door contact', 'After hours'],
      subject: { where: 'at the loading door', personCount: 1, personCountConfidence: 0.7 } },
    { id: 'a5', siteId: 's4', cameraId: '03', priority: 3, state: 'held', title: 'Delivery detected',
      raisedAt: ago(now, 930), confidence: 0.97, insidePropertyLine: false,
      chips: ['Livery matched', 'Auto-logged'],
      suppressedReason: 'Delivery signature matched · plate on allow-list' },
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

export const STILL_CAPTIONS = [
  'Subject in frame, full body, facing camera',
  'Vehicle plate region, enhanced crop',
  'Subject at property line, gait sequence',
  'Two subjects together, relative height reference',
  'Clothing detail, upper body',
  'Vehicle three-quarter view, rear quarter panel',
  'Subject reaction to announcement',
  'Departure direction, street heading',
]

export const STAGE_SCRIPT = [
  'Attention. This is private property. You are being recorded and this activity has been reported. Please return to your vehicle and leave.',
  '', // stage 1 is built from the alert's subject descriptors
  'Final warning. Leave the property now. This recording has been transmitted off-site and police have been contacted.',
  'This area remains recorded and monitored.',
]
