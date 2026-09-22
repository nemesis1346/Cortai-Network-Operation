import type { Incident, LadderState } from '../api/types'

const ms = (iso: string) => Date.parse(iso)

/** Seconds since the incident opened. */
export function incidentAgeSec(inc: Incident, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - ms(inc.openedAt)) / 1000))
}

/** Operator time on this lane: banked seconds plus the current visit. */
export function attendedSec(inc: Incident, nowMs: number): number {
  const live = inc.focusedSince ? Math.max(0, Math.floor((nowMs - ms(inc.focusedSince)) / 1000)) : 0
  return inc.attendedSec + live
}

export function unattendedSec(inc: Incident, nowMs: number): number {
  return Math.max(0, incidentAgeSec(inc, nowMs) - attendedSec(inc, nowMs))
}

/** T+ seconds of the ladder. Frozen at haltedAt when halted. Null if it never started. */
export function ladderElapsedSec(l: LadderState, nowMs: number): number | null {
  if (!l.startedAt) return null
  const end = l.haltedAt ? ms(l.haltedAt) : nowMs
  return Math.max(0, Math.floor((end - ms(l.startedAt)) / 1000))
}

/** Seconds until the next stage, or null when nothing is pending. */
export function secondsToNextStage(l: LadderState, nowMs: number): number | null {
  if (l.status !== 'running' && l.status !== 'armed') return null
  const t = ladderElapsedSec(l, nowMs)
  if (t === null) return null
  const next = l.stages.find((s) => s.index > l.firedStage)
  return next ? Math.max(0, next.atSec - t) : null
}

export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`
}
