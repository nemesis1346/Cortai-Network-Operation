import { describe, expect, it } from 'vitest'
import type { Alert, Incident, LadderState, WatchScore } from '../api/types'
import { LADDER_STAGES } from './constants'
import {
  buildCallout,
  canOpenIncident,
  checkMemo,
  derivePriority,
  isTypingTarget,
  ladderLabel,
  sortAlerts,
} from './rules'
import { attendedSec, fmtClock, ladderElapsedSec, plural, secondsToNextStage, unattendedSec } from './timing'

const alert = (o: Partial<Alert>): Alert => ({
  id: 'x', siteId: 's1', cameraId: '01', severity: 1, state: 'new', title: 't',
  raisedAt: '2026-01-01T00:00:00Z', confidence: 0.9, insidePropertyLine: false, chips: [], ...o,
})
const watch = (siteId: string, score: number): WatchScore => ({
  siteId, cameraId: '01', score, trend: 0, band: 'lo', eventCount: 1,
  clusterWindow: null, peakHours: [], signals: [], note: '',
})

describe('derivePriority', () => {
  it('computes P1-P4 from severity x inside-the-line, never set by hand', () => {
    expect(derivePriority({ severity: 1, insidePropertyLine: true })).toBe('P1')
    expect(derivePriority({ severity: 1, insidePropertyLine: false })).toBe('P2')
    expect(derivePriority({ severity: 2, insidePropertyLine: true })).toBe('P2')
    expect(derivePriority({ severity: 2, insidePropertyLine: false })).toBe('P3')
    expect(derivePriority({ severity: 3, insidePropertyLine: true })).toBe('P3')
    expect(derivePriority({ severity: 3, insidePropertyLine: false })).toBe('P4')
  })
})

describe('queue priority', () => {
  it('P1 beats P2 regardless of watch index (Yassine, 1 Oct: P is the primary key)', () => {
    const out = sortAlerts(
      [alert({ id: 'p2-hi-watch', siteId: 's2', severity: 1, insidePropertyLine: false }),
       alert({ id: 'p1-lo-watch', siteId: 's1', severity: 1, insidePropertyLine: true })],
      [watch('s1', 10), watch('s2', 90)],
    )
    expect(out.map((a) => a.id)).toEqual(['p1-lo-watch', 'p2-hi-watch'])
  })
  it('within the same priority, watch index beats age', () => {
    const out = sortAlerts(
      [alert({ id: 'old', siteId: 's1', raisedAt: '2026-01-01T00:00:00Z' }),
       alert({ id: 'watched', siteId: 's2', raisedAt: '2026-01-01T05:00:00Z' })],
      [watch('s1', 10), watch('s2', 60)],
    )
    expect(out[0]?.id).toBe('watched')
  })
  it('falls back to older first', () => {
    const out = sortAlerts(
      [alert({ id: 'new', raisedAt: '2026-01-01T05:00:00Z' }), alert({ id: 'old', raisedAt: '2026-01-01T01:00:00Z' })],
      [],
    )
    expect(out[0]?.id).toBe('old')
  })
})

describe('lane limit and memo', () => {
  it('refuses a fourth lane', () => {
    expect(canOpenIncident(2)).toBe(true)
    expect(canOpenIncident(3)).toBe(false)
  })
  it('requires a trimmed memo of minimum length', () => {
    expect(checkMemo('   short  ').ok).toBe(false)
    expect(checkMemo('Same vehicle as Tuesday, left after siren.').ok).toBe(true)
    expect(checkMemo('a long enough memo').ok).toBe(false)
  })
})

describe('callout', () => {
  it('drops low-confidence descriptors', () => {
    expect(buildCallout({ colour: 'dark', body: 'hatchback', vehicleConfidence: 0.58, personCount: 2, personCountConfidence: 0.9, where: 'at the stalls' }))
      .toBe('You are on camera at the stalls. Your image has been recorded and sent off-site.')
  })
  it('uses both when confident', () => {
    expect(buildCallout({ colour: 'white', body: 'sedan', vehicleConfidence: 0.91, personCount: 2, personCountConfidence: 0.93, where: 'at the gate' }))
      .toContain('The white sedan at the gate - the two people who left it are on camera.')
  })
})

const inc = (o: Partial<Incident> = {}): Incident => ({
  id: 'i1', alertId: 'a1', siteId: 's1', cameraId: '01', openedAt: '2026-01-01T00:00:00Z',
  laneIndex: 0, ladder: ladder(), operatorOwned: false, attendedSec: 0, focusedSince: null,
  visits: 0, noteCount: 0, siren: false, strobe: false, ...o,
})
function ladder(o: Partial<LadderState> = {}): LadderState {
  return { incidentId: 'i1', status: 'running', stages: LADDER_STAGES, firedStage: -1,
    startedAt: '2026-01-01T00:00:00Z', ...o }
}
const t = (s: number) => Date.parse('2026-01-01T00:00:00Z') + s * 1000

describe('timing', () => {
  it('splits attended and unattended', () => {
    const i = inc({ attendedSec: 10, focusedSince: '2026-01-01T00:00:50Z' })
    expect(attendedSec(i, t(60))).toBe(20)
    expect(unattendedSec(i, t(60))).toBe(40)
  })
  it('counts down to the next stage and freezes when halted', () => {
    expect(secondsToNextStage(ladder({ firedStage: 0 }), t(5))).toBe(7)
    const halted = ladder({ status: 'halted', firedStage: 0, haltedAt: '2026-01-01T00:00:05Z' })
    expect(ladderElapsedSec(halted, t(500))).toBe(5)
    expect(secondsToNextStage(halted, t(500))).toBeNull()
  })
  it('formats', () => {
    expect(fmtClock(64)).toBe('1:04')
    expect(plural(1, 'still')).toBe('1 still')
    expect(plural(0, 'still')).toBe('0 stills')
  })
})

describe('labels and hotkey guard', () => {
  it('one vocabulary for ladder state', () => {
    expect(ladderLabel(ladder({ status: 'complete', firedStage: 3 }), false)).toBe('Complete, no operator')
    expect(ladderLabel(ladder({ status: 'complete', firedStage: 3 }), true)).toBe('Complete')
  })
  it('ignores typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
