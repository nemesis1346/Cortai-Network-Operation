/**
 * NOC console API contract (phase 1 proposal).
 *
 * Conventions
 * - All timestamps are ISO-8601 UTC strings. Durations are whole seconds.
 * - The server owns state. The client sends commands and receives ServerEvents.
 * - Running timers (incident age, ladder countdown, attended time) are NOT pushed
 *   every second. The server sends anchors (startedAt, focusedSince, ...) and the
 *   client derives the value from its clock. See src/domain/timing.ts.
 */

export type ISODate = string

/* ---------- Estate ---------- */

export type CameraStatus = 'live' | 'motion' | 'down'

export interface Camera {
  id: string // "07"
  siteId: string
  name: string // "Gate / driveway"
  status: CameraStatus
  /** Privacy mask active on this camera. */
  masked?: boolean
  /** When status became 'down'. Present only if down. */
  downSince?: ISODate
}

export interface Site {
  id: string
  name: string // "138 Hope St N"
  locality: string // "Port Hope"
  cameraIds: string[]
}

/* ---------- Alerts ---------- */

/**
 * new     - in queue, no lane
 * working - an open incident holds a lane for it
 * held    - parked (auto-logged, suppressed, or its incident was closed)
 * closed  - resolved and archived
 */
export type AlertState = 'new' | 'working' | 'held' | 'closed'

/** 1 = highest. */
export type AlertPriority = 1 | 2 | 3

export interface SubjectDescription {
  colour?: string
  body?: string
  vehicleConfidence?: number // 0..1
  where?: string
  personCount?: number
  personCountConfidence?: number // 0..1
}

export interface Alert {
  id: string
  siteId: string
  cameraId: string
  priority: AlertPriority
  state: AlertState
  title: string
  raisedAt: ISODate
  /** Detection confidence 0..1, null for non-detection alerts (camera fault). */
  confidence: number | null
  /** Subject is inside the property line. Top sort key. */
  insidePropertyLine: boolean
  chips: string[]
  subject?: SubjectDescription
  /**
   * If set, the voice ladder is suppressed for this alert and the text says why.
   * Example: "Subject outside property line - log only, do not address".
   */
  suppressedReason?: string
}

/* ---------- Watch list ---------- */

export type WatchBand = 'hi' | 'md' | 'lo'

export interface WatchSignal {
  count: number
  text: string
  when: string
}

export interface WatchScore {
  siteId: string
  cameraId: string
  score: number // 0..100
  /** Signed change vs. previous 7-day window. */
  trend: number
  band: WatchBand
  eventCount: number
  /** Night cluster window, "00:40 - 01:30", or null when there is none. */
  clusterWindow: string | null
  /** Hours (0..23) where the cluster peaks. Drives the 24h strip. */
  peakHours: number[]
  signals: WatchSignal[]
  note: string
}

/* ---------- Voice ladder ---------- */

export type LadderStatus =
  | 'armed' // waiting for stage 0
  | 'running'
  | 'halted' // operator took over
  | 'suppressed' // never runs (see Alert.suppressedReason)
  | 'complete' // all stages played

export interface LadderStageDef {
  index: 0 | 1 | 2 | 3
  name: string
  /** Seconds after ladder start at which the stage fires. */
  atSec: number
}

export interface LadderState {
  incidentId: string
  status: LadderStatus
  stages: LadderStageDef[]
  /** Last stage that has fired, -1 if none. */
  firedStage: -1 | 0 | 1 | 2 | 3
  /** Anchor for the countdown. Absent while suppressed. */
  startedAt?: ISODate
  /** Freezes the countdown. Present when halted. */
  haltedAt?: ISODate
  haltReason?: string
  suppressedReason?: string
}

/* ---------- Incidents ---------- */

export interface Incident {
  id: string
  alertId: string
  siteId: string
  cameraId: string
  openedAt: ISODate
  /** Server-assigned lane order. UI lane letters derive from this. */
  laneIndex: 0 | 1 | 2
  ladder: LadderState
  /** True when the operator has ever taken this lane (ladder stops being "unattended"). */
  operatorOwned: boolean
  /** Seconds of operator focus banked before focusedSince. */
  attendedSec: number
  /** Anchor. Non-null while the operator is currently on this lane. */
  focusedSince: ISODate | null
  /** Number of times the operator entered the lane. */
  visits: number
  noteCount: number
  siren: boolean
  strobe: boolean
  memo?: string
  nextSteps?: NextStepId[]
}

export type NextStepId = 'report' | 'police' | 'owner' | 'plate' | 'patrol' | 'tune'

/* ---------- Ledger, evidence, transcript ---------- */

export type LedgerKind = 'enter' | 'leave' | 'voice' | 'note' | 'action' | 'still'

export interface LedgerEvent {
  id: string
  incidentId: string
  at: ISODate
  kind: LedgerKind
  text: string
  /** Seconds since incident open, for report export. */
  tPlusSec: number
}

export interface EvidenceStill {
  id: string
  incidentId: string
  capturedAt: ISODate
  tPlusSec: number
  description: string
  confidence: number | null
  /** URL of the still. Phase 1 mock returns null and the UI draws a placeholder. */
  imageUrl: string | null
}

export type TranscriptSpeaker = 'ai' | 'op' | 'sys'

export interface TranscriptLine {
  id: string
  at: ISODate
  speaker: TranscriptSpeaker
  /** Absent for shift-level lines such as "Voice gateway OK". */
  incidentId?: string
  text: string
}

/* ---------- Shift ---------- */

export interface Operator {
  id: string
  name: string
  desk: number
}

export interface ShiftInfo {
  startedAt: ISODate
  operator: Operator
  camerasEnrolled: number
  speakersReachable: number
}

export interface DeskPage {
  desk: number
  pagedAt: ISODate
  reason: string
  acknowledgedAt?: ISODate
}

export interface ShiftStats {
  /** Closed incidents only. Open incidents add their live values on the client. */
  closedAttendedSec: number
  closedUnattendedSec: number
  visits: number
  notes: number
}

/* ---------- Snapshot + events ---------- */

export interface Snapshot {
  serverTime: ISODate
  shift: ShiftInfo
  sites: Site[]
  cameras: Camera[]
  alerts: Alert[]
  incidents: Incident[]
  watch: WatchScore[]
  ledger: LedgerEvent[]
  evidence: EvidenceStill[]
  transcript: TranscriptLine[]
  stats: ShiftStats
  /** Incident that currently owns the microphone. */
  micOwnerIncidentId: string | null
  /** Incident the operator is focused on. */
  focusIncidentId: string | null
  pages: DeskPage[]
  /** Speaker channel state for the voice strip. */
  speaker: SpeakerState
}

export interface SpeakerState {
  mode: 'idle' | 'ai' | 'human'
  label: string
}

/**
 * Everything the store reduces. The mock ticker and a future WebSocket emit
 * exactly these; components never see the transport.
 */
export type ServerEvent =
  | { type: 'alert.upsert'; alert: Alert }
  | { type: 'incident.upsert'; incident: Incident }
  | { type: 'incident.closed'; incidentId: string; stats: ShiftStats }
  | { type: 'ladder.updated'; ladder: LadderState }
  | { type: 'ledger.added'; event: LedgerEvent }
  | { type: 'evidence.added'; still: EvidenceStill }
  | { type: 'transcript.added'; line: TranscriptLine }
  | { type: 'camera.updated'; camera: Camera }
  | { type: 'watch.updated'; watch: WatchScore }
  | { type: 'focus.changed'; incidentId: string | null }
  | { type: 'mic.changed'; incidentId: string | null }
  | { type: 'speaker.changed'; speaker: SpeakerState }
  | { type: 'desk.paged'; page: DeskPage }
  | { type: 'desk.page.acknowledged'; desk: number; at: ISODate }

/* ---------- Commands ---------- */

export type ErrorCode =
  | 'LANE_LIMIT' // three incidents already open
  | 'MIC_BUSY' // mic bound to another lane, retry with force
  | 'MEMO_TOO_SHORT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'

export interface ApiError {
  code: ErrorCode
  message: string
  /** MIC_BUSY: the incident that currently holds the mic. */
  micOwnerIncidentId?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError }

export interface CloseIncidentInput {
  memo: string
  nextSteps: NextStepId[]
}

export interface IncidentReport {
  incident: Incident
  alert: Alert
  site: Site
  watch: WatchScore | null
  operator: Operator
  ledger: LedgerEvent[]
  evidence: EvidenceStill[]
}
