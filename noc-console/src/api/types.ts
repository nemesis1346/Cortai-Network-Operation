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

/**
 * Health of an actively-watched stream, distinct from Camera.status (which
 * describes the camera whether or not anyone is currently decoding it).
 * Phase 1 never produces anything but 'live' — typed now so the real player
 * (WebRTC/go2rtc) has somewhere to report into without a prop-shape change
 * later. See noc-console/docs/API-CONTRACT.md.
 */
export type VideoSignal = 'live' | 'degraded' | 'lost' | 'connecting'

export interface Camera {
  id: string // "07"
  siteId: string
  name: string // "Gate / driveway"
  status: CameraStatus
  /** Privacy mask active on this camera. */
  masked?: boolean
  /** When status became 'down'. Present only if down. */
  downSince?: ISODate
  /** Current stream health. Absent when nothing is actively decoding it. */
  signal?: VideoSignal
  /** Glass-to-glass latency in ms for the active stream, when known. */
  latencyMs?: number
}

/**
 * One AI detection backing a bounding-box overlay. `box` is `[x, y, w, h]`,
 * each 0..1 of the frame — same convention a real detector would use, so
 * this isn't a UI-only shape invented for the mock.
 */
export interface Detection {
  label: string
  confidence: number // 0..1
  box: [x: number, y: number, w: number, h: number]
}

export interface Site {
  id: string
  name: string // "138 Hope St N"
  locality: string // "Port Hope"
  cameraIds: string[]
  /**
   * Overrides the global response-ladder stage timings for incidents at this
   * site. Falls back to domain/constants.ts's LADDER_STAGES when absent.
   * Yassine, 1 Oct: ladder timings come from the site procedure, 30/45/60s
   * (the existing default) as fallback.
   */
  ladderStages?: LadderStageDef[]
}

/* ---------- Alerts ---------- */

/**
 * new     - in queue, no lane
 * working - an open incident holds a lane for it
 * held    - parked (auto-logged, suppressed, or its incident was closed)
 * closed  - resolved and archived
 */
export type AlertState = 'new' | 'working' | 'held' | 'closed'

/**
 * The AI's raw event-type classification — 1 = highest. This is an input,
 * not the sort key: the queue's actual priority (P1–P4) is computed from
 * this plus insidePropertyLine. See domain/rules.ts#derivePriority and
 * docs/API-CONTRACT.md §1. Yassine, 1 Oct: "P derived deterministically
 * from inside-the-line, never set by hand" — this field is the deterministic
 * input, not a hand-set P value.
 */
export type AlertSeverity = 1 | 2 | 3

export interface SubjectDescription {
  colour?: string
  body?: string
  vehicleConfidence?: number // 0..1
  where?: string
  personCount?: number
  personCountConfidence?: number // 0..1
}

export type RiskFactorWeight = 'high' | 'medium' | 'low'

/** Why-this-alert reasoning (v2 COMPONENTS.md#RiskFactor), replacing the mockup's plain chips. */
export interface RiskFactorData {
  label: string
  weight: RiskFactorWeight
}

export interface Alert {
  id: string
  siteId: string
  cameraId: string
  severity: AlertSeverity
  state: AlertState
  title: string
  raisedAt: ISODate
  /** Detection confidence 0..1, null for non-detection alerts (camera fault). */
  confidence: number | null
  /** Inside the property line — the deterministic input to derivePriority, not a sort key itself. */
  insidePropertyLine: boolean
  /** Sorted high-weight first; mock seed data keeps that invariant rather than sorting at render. */
  riskFactors: RiskFactorData[]
  subject?: SubjectDescription
  /** AI detections backing the bounding-box overlay, when available. */
  detections?: Detection[]
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

/** v2 COMPONENTS.md#EvidenceThumb's four categories. */
export type EvidenceKind = 'plate' | 'face' | 'body' | 'scene'

export interface EvidenceStill {
  id: string
  incidentId: string
  capturedAt: ISODate
  tPlusSec: number
  kind: EvidenceKind
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
