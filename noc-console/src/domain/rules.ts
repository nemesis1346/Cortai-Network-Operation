import type { Alert, Incident, LadderState, LedgerKind, WatchScore } from '../api/types'
import { LANE_LETTERS, MAX_LANES, MEMO_MIN_LENGTH, SLOT_MIN_CONFIDENCE } from './constants'

/**
 * Queue priority: inside property line > watch index > age.
 * Lexicographic, so age can never outrank a higher tier (the mockup's
 * weighted sum let a long-waiting alert leapfrog a watch-index difference).
 */
export function compareAlerts(
  a: Alert,
  b: Alert,
  watchBySite: ReadonlyMap<string, WatchScore>,
): number {
  if (a.insidePropertyLine !== b.insidePropertyLine) return a.insidePropertyLine ? -1 : 1
  const wa = watchBySite.get(a.siteId)?.score ?? 0
  const wb = watchBySite.get(b.siteId)?.score ?? 0
  if (wa !== wb) return wb - wa
  return Date.parse(a.raisedAt) - Date.parse(b.raisedAt) // older first
}

export function sortAlerts(alerts: Alert[], watch: WatchScore[]): Alert[] {
  const bySite = new Map(watch.map((w) => [w.siteId, w]))
  return [...alerts].sort((a, b) => compareAlerts(a, b, bySite))
}

export function canOpenIncident(openIncidents: number): boolean {
  return openIncidents < MAX_LANES
}

export type MemoCheck = { ok: true } | { ok: false; length: number; min: number }

export function checkMemo(memo: string): MemoCheck {
  const length = memo.trim().length
  return length >= MEMO_MIN_LENGTH ? { ok: true } : { ok: false, length, min: MEMO_MIN_LENGTH }
}

export function laneLetter(inc: Incident): string {
  return LANE_LETTERS[inc.laneIndex] ?? '-'
}

/** "Open" = incidents holding a lane. One definition for the top bar and the Working tab. */
export function openCount(incidents: Incident[]): number {
  return incidents.length
}

/** Voice callout built only from descriptors above the confidence floor. */
export function buildCallout(subject: Alert['subject']): string {
  const d = subject ?? {}
  const veh =
    (d.vehicleConfidence ?? 0) >= SLOT_MIN_CONFIDENCE && d.colour && d.body
      ? `The ${d.colour} ${d.body}`
      : null
  const n = d.personCount
  const people =
    (d.personCountConfidence ?? 0) >= SLOT_MIN_CONFIDENCE && n
      ? n === 1
        ? 'the person who left it is'
        : `the ${n === 2 ? 'two' : n} people who left it are`
      : null
  const where = d.where ? ` ${d.where}` : ''
  if (veh && people) return `${veh}${where} - ${people} on camera. Your vehicle and plate have been recorded.`
  if (veh) return `${veh}${where} has been recorded, including the plate.`
  if (people) return `You are on camera${where}. Your image has been recorded and sent off-site.`
  return 'You are on camera. Your image has been recorded and sent off-site.'
}

/** Single vocabulary for ladder state (audit A9: one wording per state). */
export function ladderLabel(l: LadderState, operatorOwned: boolean): string {
  switch (l.status) {
    case 'suppressed':
      return 'Suppressed'
    case 'halted':
      return 'Halted'
    case 'complete':
      return operatorOwned ? 'Complete' : 'Complete, no operator'
    case 'armed':
      return 'Armed'
    case 'running':
      return l.stages.find((s) => s.index === l.firedStage)?.name ?? 'Running'
  }
}

const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  enter: 'Entered',
  leave: 'Left',
  voice: 'Voice',
  note: 'Note',
  action: 'Action',
  still: 'Still',
}

/** Single vocabulary for ledger rows, reused by the activity rail and the report. */
export function ledgerKindLabel(kind: LedgerKind): string {
  return LEDGER_KIND_LABEL[kind]
}

/** Global hotkeys must never fire while the operator is typing (audit C1). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null
  if (!el || typeof el.tagName !== 'string') return false
  return el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}
