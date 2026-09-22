import type { NocClient } from '../client'
import type {
  Alert,
  ApiError,
  CloseIncidentInput,
  DeskPage,
  EvidenceStill,
  Incident,
  IncidentReport,
  LadderState,
  LedgerEvent,
  LedgerKind,
  Result,
  ServerEvent,
  ShiftStats,
  Snapshot,
  SpeakerState,
  TranscriptLine,
  TranscriptSpeaker,
  WatchScore,
} from '../types'
import { LADDER_STAGES, MAX_LANES, MEMO_MIN_LENGTH } from '../../domain/constants'
import { buildCallout, checkMemo } from '../../domain/rules'
import { attendedSec, incidentAgeSec, ladderElapsedSec } from '../../domain/timing'
import { STAGE_SCRIPT, STILL_CAPTIONS, seedAlerts, seedEstate, seedWatch } from './data'

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const fail = (code: ApiError['code'], message: string, extra?: Partial<ApiError>): Result<never> => ({
  ok: false,
  error: { code, message, ...extra },
})

/**
 * In-memory NocClient. It plays the role of the backend: it owns state, runs the
 * voice ladder and evidence capture on a 1 s tick, and emits ServerEvents. The
 * UI store must not be able to tell it apart from a WebSocket feed.
 */
export class MockNocClient implements NocClient {
  private listeners = new Set<(e: ServerEvent) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private seq = 0

  private snap: Snapshot
  private closedAttended = 0
  private closedUnattended = 0

  constructor(now: number = Date.now()) {
    const { sites, cameras } = seedEstate(now)
    const iso = new Date(now).toISOString()
    this.snap = {
      serverTime: iso,
      shift: {
        startedAt: new Date(now - 2 * 3600_000).toISOString(),
        operator: { id: 'op1', name: 'M. Okafor', desk: 2 },
        camerasEnrolled: cameras.length,
        speakersReachable: 11,
      },
      sites,
      cameras,
      alerts: seedAlerts(now),
      incidents: [],
      watch: seedWatch(),
      ledger: [],
      evidence: [],
      transcript: [],
      stats: { closedAttendedSec: 0, closedUnattendedSec: 0, visits: 0, notes: 0 },
      micOwnerIncidentId: null,
      focusIncidentId: null,
      pages: [],
      speaker: { mode: 'idle', label: 'Silent' },
    }
    this.transcript('sys', `Shift handover accepted · ${cameras.length} cameras enrolled, 0 decoding`)
    this.transcript('sys', 'Voice gateway OK · 11 site speakers reachable')
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), 1000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /* ---------- NocClient: reads ---------- */

  async getSnapshot(): Promise<Snapshot> {
    return structuredClone({ ...this.snap, serverTime: new Date().toISOString() })
  }

  subscribe(handler: (e: ServerEvent) => void): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  /* ---------- NocClient: commands ---------- */

  async openIncident(alertId: string): Promise<Result<Incident>> {
    const existing = this.snap.incidents.find((i) => i.alertId === alertId)
    if (existing) return ok(existing)
    const alert = this.snap.alerts.find((a) => a.id === alertId)
    if (!alert) return fail('NOT_FOUND', 'Alert not found')
    if (this.snap.incidents.length >= MAX_LANES) {
      return fail('LANE_LIMIT', 'All three lanes are in use. Free a lane or page the second desk.')
    }
    const now = new Date().toISOString()
    const used = new Set(this.snap.incidents.map((i) => i.laneIndex))
    const laneIndex = ([0, 1, 2] as const).find((n) => !used.has(n)) ?? 0
    const id = `i${++this.seq}`
    const suppressed = alert.suppressedReason
    const ladder: LadderState = {
      incidentId: id,
      status: suppressed ? 'suppressed' : 'running',
      stages: LADDER_STAGES,
      firedStage: -1,
      startedAt: suppressed ? undefined : now,
      suppressedReason: suppressed,
    }
    const incident: Incident = {
      id, alertId, siteId: alert.siteId, cameraId: alert.cameraId, openedAt: now, laneIndex, ladder,
      operatorOwned: false, attendedSec: 0, focusedSince: null, visits: 0, noteCount: 0,
      siren: false, strobe: false,
    }
    this.snap.incidents.push(incident)
    this.setAlertState(alert, 'working')
    this.emit({ type: 'incident.upsert', incident })
    this.ledger(incident, 'action', 'Incident opened from queue')

    const site = this.snap.sites.find((s) => s.id === alert.siteId)
    const cam = this.snap.cameras.find((c) => c.id === alert.cameraId)
    this.transcript(
      'sys',
      `Incident opened · ${site?.name} · Cam ${cam?.id}` +
        (suppressed ? ` · ladder suppressed (${suppressed})` : ' · ladder armed unattended'),
      id,
    )
    const w = this.snap.watch.find((x) => x.siteId === alert.siteId)
    if (w?.band === 'hi') {
      this.transcript('sys', `Site on watch list · index ${w.score} ${w.trend > 0 ? '+' : ''}${w.trend} · cluster ${w.clusterWindow ?? 'none'}`, id)
    }
    if (!this.snap.focusIncidentId) await this.setFocus(id)
    return ok(incident)
  }

  async setFocus(incidentId: string | null): Promise<Result<null>> {
    if (incidentId === this.snap.focusIncidentId) return ok(null)
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()

    const prev = this.snap.incidents.find((i) => i.id === this.snap.focusIncidentId)
    if (prev?.focusedSince) {
      const held = Math.floor((nowMs - Date.parse(prev.focusedSince)) / 1000)
      prev.attendedSec += held
      prev.focusedSince = null
      this.emit({ type: 'incident.upsert', incident: prev })
      this.ledger(prev, 'leave', `Operator left after ${Math.floor(held / 60)}:${String(held % 60).padStart(2, '0')} on lane`)
    }
    if (incidentId) {
      const next = this.snap.incidents.find((i) => i.id === incidentId)
      if (!next) return fail('NOT_FOUND', 'Incident not found')
      next.focusedSince = now
      next.visits += 1
      next.operatorOwned = true
      this.snap.stats.visits += 1
      this.emit({ type: 'incident.upsert', incident: next })
      this.ledger(next, 'enter', `Operator entered lane · visit ${next.visits}`)
    }
    this.snap.focusIncidentId = incidentId
    this.emit({ type: 'focus.changed', incidentId })
    return ok(null)
  }

  async bindMic(incidentId: string | null, opts?: { force?: boolean }): Promise<Result<null>> {
    const owner = this.snap.micOwnerIncidentId
    if (incidentId === null) {
      if (owner) this.releaseMic('operator closed mic')
      return ok(null)
    }
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    if (owner && owner !== incidentId) {
      if (!opts?.force) {
        return fail('MIC_BUSY', 'Microphone is open to another lane', { micOwnerIncidentId: owner })
      }
      this.releaseMic('mic moved')
    }
    if (owner === incidentId) return ok(null)
    this.snap.micOwnerIncidentId = incidentId
    inc.operatorOwned = true
    this.emit({ type: 'mic.changed', incidentId })
    this.haltLadderInternal(inc, 'operator opened microphone')
    this.speaker({ mode: 'human', label: `Operator → ${this.siteName(inc)}` })
    this.transcript('op', `Microphone open to ${this.siteName(inc)}`, inc.id)
    this.ledger(inc, 'action', 'Two-way channel opened to site loudspeaker')
    return ok(null)
  }

  async haltLadder(incidentId: string): Promise<Result<null>> {
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    inc.operatorOwned = true
    this.haltLadderInternal(inc, 'operator halted')
    this.emit({ type: 'incident.upsert', incident: inc })
    return ok(null)
  }

  async setSiren(incidentId: string, on: boolean): Promise<Result<null>> {
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    inc.siren = on
    if (on) this.haltLadderInternal(inc, 'operator engaged siren')
    this.emit({ type: 'incident.upsert', incident: inc })
    this.ledger(inc, 'action', `Siren ${on ? 'engaged' : 'silenced'} · site loudspeaker array`)
    this.transcript('sys', `Siren ${on ? 'ON' : 'OFF'} · ${this.siteName(inc)}`, inc.id)
    if (on) this.capture(inc, 'Siren engaged - subject reaction frame')
    return ok(null)
  }

  async setStrobe(incidentId: string, on: boolean): Promise<Result<null>> {
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    inc.strobe = on
    this.emit({ type: 'incident.upsert', incident: inc })
    this.ledger(inc, 'action', `Strobe ${on ? 'engaged' : 'off'} · perimeter lighting`)
    this.transcript('sys', `Strobe ${on ? 'ON' : 'OFF'} · ${this.siteName(inc)}`, inc.id)
    return ok(null)
  }

  async addNote(incidentId: string, text: string): Promise<Result<null>> {
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    const v = text.trim()
    if (!v) return fail('INVALID_STATE', 'Note is empty')
    inc.noteCount += 1
    this.snap.stats.notes += 1
    this.emit({ type: 'incident.upsert', incident: inc })
    this.ledger(inc, 'note', v)
    this.transcript('op', `Note · ${this.siteName(inc)} · ${v}`, inc.id)
    return ok(null)
  }

  async closeIncident(incidentId: string, input: CloseIncidentInput): Promise<Result<IncidentReport>> {
    const inc = this.snap.incidents.find((i) => i.id === incidentId)
    if (!inc) return fail('NOT_FOUND', 'Incident not found')
    if (!checkMemo(input.memo).ok) {
      return fail('MEMO_TOO_SHORT', `Memo must be at least ${MEMO_MIN_LENGTH} characters`)
    }
    const nowMs = Date.now()
    if (inc.focusedSince) {
      inc.attendedSec = attendedSec(inc, nowMs)
      inc.focusedSince = null
    }
    inc.memo = input.memo.trim()
    inc.nextSteps = input.nextSteps
    this.snap.stats.notes += 1
    this.ledger(inc, 'note', `Closing memo · ${inc.memo}`)
    for (const s of input.nextSteps) this.ledger(inc, 'action', `Next step queued · ${s}`)

    if (this.snap.micOwnerIncidentId === inc.id) this.releaseMic('incident closed')
    const age = incidentAgeSec(inc, nowMs)
    this.closedAttended += inc.attendedSec
    this.closedUnattended += Math.max(0, age - inc.attendedSec)
    this.snap.stats.closedAttendedSec = this.closedAttended
    this.snap.stats.closedUnattendedSec = this.closedUnattended

    const report = this.buildReport(inc)
    this.transcript('sys', `Incident closed · ${this.siteName(inc)} · closed with memo`, inc.id)

    this.snap.incidents = this.snap.incidents.filter((i) => i.id !== inc.id)
    const alert = this.snap.alerts.find((a) => a.id === inc.alertId)
    if (alert) this.setAlertState(alert, 'held')
    const stats: ShiftStats = { ...this.snap.stats }
    this.emit({ type: 'incident.closed', incidentId: inc.id, stats })

    if (this.snap.focusIncidentId === inc.id) {
      this.snap.focusIncidentId = null
      this.emit({ type: 'focus.changed', incidentId: null })
      const first = this.snap.incidents[0]
      if (first) await this.setFocus(first.id)
    }
    return ok(report)
  }

  async acknowledgePage(desk: number): Promise<Result<null>> {
    const p = this.snap.pages.find((x) => x.desk === desk && !x.acknowledgedAt)
    if (!p) return fail('NOT_FOUND', 'No active page')
    p.acknowledgedAt = new Date().toISOString()
    this.emit({ type: 'desk.page.acknowledged', desk, at: p.acknowledgedAt })
    return ok(null)
  }

  /* ---------- simulation ---------- */

  private tick(): void {
    const nowMs = Date.now()
    for (const inc of this.snap.incidents) {
      const age = incidentAgeSec(inc, nowMs)
      if (age === 2 || (age > 0 && age % 9 === 0)) this.capture(inc)

      const l = inc.ladder
      if (l.status !== 'running') continue
      const t = ladderElapsedSec(l, nowMs) ?? 0
      for (const s of l.stages) {
        if (t >= s.atSec && l.firedStage < s.index) this.fireStage(inc, s.index)
      }
    }
    this.maybePage()
  }

  private fireStage(inc: Incident, index: 0 | 1 | 2 | 3): void {
    const l = inc.ladder
    l.firedStage = index
    const alert = this.snap.alerts.find((a) => a.id === inc.alertId)
    const text = index === 1 ? buildCallout(alert?.subject) : (STAGE_SCRIPT[index] ?? '')
    const focused = this.snap.focusIncidentId === inc.id
    if (index === 3) {
      this.transcript('sys', 'Siren engaged · 8s', inc.id)
      l.status = 'complete'
    }
    this.transcript('ai', text, inc.id)
    this.ledger(inc, 'voice', `Stage ${index + 1} played · ${LADDER_STAGES[index]?.name}${focused ? ' (operator present)' : ' (unattended)'}`)
    if (!inc.operatorOwned) {
      this.speaker({ mode: index === 3 ? 'human' : 'ai', label: `${index === 3 ? 'Siren' : 'AI'} · ${this.siteName(inc)}` })
    }
    if (index === 3) this.transcript('sys', `Ladder complete · ${this.siteName(inc)} · clip and plate packaged`, inc.id)
    this.emit({ type: 'ladder.updated', ladder: { ...l } })
  }

  private haltLadderInternal(inc: Incident, reason: string): void {
    const l = inc.ladder
    if (l.status !== 'running') return
    l.status = 'halted'
    l.haltedAt = new Date().toISOString()
    l.haltReason = reason
    const t = ladderElapsedSec(l, Date.now()) ?? 0
    const at = l.firedStage < 0 ? 'before first stage' : `after ${LADDER_STAGES[l.firedStage]?.name.toLowerCase()}`
    this.transcript('sys', `Ladder interrupted at T+${t}s, ${at} - ${reason}`, inc.id)
    this.emit({ type: 'ladder.updated', ladder: { ...l } })
  }

  private maybePage(): void {
    if (this.snap.pages.some((p) => !p.acknowledgedAt)) return
    const stalled = this.snap.incidents.filter((i) => !i.operatorOwned && i.ladder.firedStage >= 3)
    if (!stalled.length) return
    const page: DeskPage = {
      desk: 3,
      pagedAt: new Date().toISOString(),
      reason: `${stalled.length} incident(s) reached siren stage unattended`,
    }
    this.snap.pages.push(page)
    this.transcript('sys', `Auto-page sent to desk 3 and on-call - ${page.reason}`)
    this.emit({ type: 'desk.paged', page })
  }

  private capture(inc: Incident, forced?: string): void {
    const alert = this.snap.alerts.find((a) => a.id === inc.alertId)
    const count = this.snap.evidence.filter((e) => e.incidentId === inc.id).length
    const nowMs = Date.now()
    const description = forced ?? STILL_CAPTIONS[count % STILL_CAPTIONS.length] ?? 'Still'
    const still: EvidenceStill = {
      id: `e${++this.seq}`, incidentId: inc.id, capturedAt: new Date(nowMs).toISOString(),
      tPlusSec: incidentAgeSec(inc, nowMs), description, confidence: alert?.confidence ?? null, imageUrl: null,
    }
    this.snap.evidence.push(still)
    this.emit({ type: 'evidence.added', still })
    this.ledger(inc, 'still', `Still captured · ${description}`)
  }

  /* ---------- helpers ---------- */

  private releaseMic(reason: string): void {
    const inc = this.snap.incidents.find((i) => i.id === this.snap.micOwnerIncidentId)
    if (inc) {
      this.transcript('sys', `Microphone closed - ${reason}`, inc.id)
      this.ledger(inc, 'action', 'Two-way channel closed')
    }
    this.snap.micOwnerIncidentId = null
    this.emit({ type: 'mic.changed', incidentId: null })
    this.speaker({ mode: 'idle', label: 'Silent' })
  }

  private speaker(s: SpeakerState): void {
    this.snap.speaker = s
    this.emit({ type: 'speaker.changed', speaker: s })
  }

  private setAlertState(alert: Alert, state: Alert['state']): void {
    alert.state = state
    this.emit({ type: 'alert.upsert', alert: { ...alert } })
  }

  private siteName(inc: Incident): string {
    return this.snap.sites.find((s) => s.id === inc.siteId)?.name ?? inc.siteId
  }

  private ledger(inc: Incident, kind: LedgerKind, text: string): void {
    const now = Date.now()
    const event: LedgerEvent = {
      id: `l${++this.seq}`, incidentId: inc.id, at: new Date(now).toISOString(), kind, text,
      tPlusSec: incidentAgeSec(inc, now),
    }
    this.snap.ledger.push(event)
    this.emit({ type: 'ledger.added', event })
  }

  private transcript(speaker: TranscriptSpeaker, text: string, incidentId?: string): void {
    const line: TranscriptLine = { id: `t${++this.seq}`, at: new Date().toISOString(), speaker, incidentId, text }
    this.snap.transcript.push(line)
    this.emit({ type: 'transcript.added', line })
  }

  private buildReport(inc: Incident): IncidentReport {
    const alert = this.snap.alerts.find((a) => a.id === inc.alertId) as Alert
    return structuredClone({
      incident: inc,
      alert,
      site: this.snap.sites.find((s) => s.id === inc.siteId)!,
      watch: this.snap.watch.find((w: WatchScore) => w.siteId === inc.siteId) ?? null,
      operator: this.snap.shift.operator,
      ledger: this.snap.ledger.filter((e) => e.incidentId === inc.id),
      evidence: this.snap.evidence.filter((e) => e.incidentId === inc.id),
    })
  }

  private emit(e: ServerEvent): void {
    // Clone so subscribers can never mutate the mock's internal state.
    const copy = structuredClone(e)
    for (const l of this.listeners) l(copy)
  }
}
