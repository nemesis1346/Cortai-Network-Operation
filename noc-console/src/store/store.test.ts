import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockNocClient } from '../api/mock/MockNocClient'
import { derivePriority } from '../domain/rules'
import { alertCounts } from './selectors'
import { NocStore } from './store'

async function boot() {
  const client = new MockNocClient()
  const store = new NocStore(client)
  await store.connect()
  return store
}

// Ticking (voice ladder, auto-page) runs on the client's own 1s interval,
// started separately from connect() (main.tsx does it after connect resolves).
// Tests that need the tick need the client itself, not just the store.
async function bootWithClient() {
  const client = new MockNocClient()
  const store = new NocStore(client)
  await store.connect()
  return { store, client }
}
const server = (s: NocStore) => s.getState().server!

describe('store over the mock client', () => {
  it('open incidents equals the Working count (audit C5)', async () => {
    const store = await boot()
    await store.openIncident('a1')
    await store.openIncident('a2')
    expect(server(store).incidents.length).toBe(2)
    expect(alertCounts(server(store)).working).toBe(2)
  })

  it('refuses a fourth lane and shows the refusal at the queue', async () => {
    const store = await boot()
    for (const id of ['a1', 'a2', 'a3']) await store.openIncident(id)
    await store.openIncident('a4')
    expect(server(store).incidents.length).toBe(3)
    expect(store.getState().ui.queueRefusal).toMatch(/three lanes/i)
  })

  it('first opened incident takes focus and writes an enter event', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const s = server(store)
    expect(s.focusIncidentId).toBe(s.incidents[0]!.id)
    expect(s.ledger.some((e) => e.kind === 'enter')).toBe(true)
  })

  it('moving focus while the mic is bound elsewhere asks first', async () => {
    const store = await boot()
    await store.openIncident('a1')
    await store.openIncident('a2')
    const [a, b] = server(store).incidents
    await store.toggleMic(a!.id)
    await store.requestFocus(b!.id)
    expect(store.getState().ui.micConfirm?.targetIncidentId).toBe(b!.id)
    expect(server(store).focusIncidentId).toBe(a!.id)
    await store.confirmMicMove()
    expect(server(store).focusIncidentId).toBe(b!.id)
    expect(server(store).micOwnerIncidentId).toBeNull()
  })

  it('will not close without a long enough memo, then closes and holds the alert', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const id = server(store).incidents[0]!.id
    store.openCloseout(id)
    expect(await store.submitCloseout('too short', [])).toBe(false)
    expect(server(store).incidents.length).toBe(1)
    expect(await store.submitCloseout('Same white sedan as Tuesday, left after announcement.', ['report'])).toBe(true)
    expect(server(store).incidents.length).toBe(0)
    expect(store.getState().ui.report).not.toBeNull()
    expect(alertCounts(server(store)).working).toBe(0)
  })

  it('holds a new alert without opening a lane (Yassine, 1 Oct)', async () => {
    const store = await boot()
    await store.holdAlert('a1')
    const s = server(store)
    expect(s.alerts.find((a) => a.id === 'a1')?.state).toBe('held')
    expect(s.incidents.length).toBe(0)
  })

  it('resumes a halted ladder from where it paused, not from 0', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const id = server(store).incidents[0]!.id
    await store.haltLadder(id)
    expect(server(store).incidents[0]!.ladder.status).toBe('halted')
    await store.resumeLadder(id)
    const l = server(store).incidents[0]!.ladder
    expect(l.status).toBe('running')
    expect(l.haltedAt).toBeUndefined()
    // startedAt shifts forward so elapsed-since-start stays ~0, not restarted at wall-clock now with no offset
    expect(Date.now() - Date.parse(l.startedAt!)).toBeLessThan(1000)
  })

  it('pages the second desk on request and clears the refusal', async () => {
    const store = await boot()
    for (const id of ['a1', 'a2', 'a3']) await store.openIncident(id)
    await store.openIncident('a4') // refused, 3 lanes already open
    expect(store.getState().ui.queueRefusal).not.toBeNull()
    await store.pageSecondDesk()
    expect(store.getState().ui.queueRefusal).toBeNull()
    expect(server(store).pages.some((p) => !p.acknowledgedAt)).toBe(true)
  })
})

describe('self-escalation and auto-paging (v2 STATES.md §2)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a newly opened peripheral lane starts its own unattended streak at 0', async () => {
    const store = await boot()
    await store.openIncident('a1')
    await store.openIncident('a2')
    const [focused, peripheral] = server(store).incidents
    expect(focused!.unattendedSince).toBeNull()
    expect(peripheral!.unattendedSince).not.toBeNull()
    expect(peripheral!.escalationAcked).toBe(false)
  })

  it('auto-pages desk 3 once a lane crosses the 60s alarm threshold, not before', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    await store.openIncident('a2') // peripheral from the moment it opens
    client.start()
    vi.advanceTimersByTime(59_000)
    expect(server(store).pages.length).toBe(0)
    vi.advanceTimersByTime(2_000) // crosses 60s
    expect(server(store).pages.some((p) => !p.acknowledgedAt)).toBe(true)
    client.stop()
  })

  it('focusing an unattended lane resets its streak and clears any ack', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    await store.openIncident('a2')
    client.start()
    vi.advanceTimersByTime(45_000)
    const id = server(store).incidents[1]!.id
    await store.acknowledgeEscalation(id)
    await store.requestFocus(id)
    const inc = server(store).incidents.find((i) => i.id === id)!
    expect(inc.unattendedSince).toBeNull()
    expect(inc.escalationAcked).toBe(false)
    client.stop()
  })

  it('acknowledging silences the bar for that lane without resetting the streak or blocking the auto-page', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    await store.openIncident('a2')
    client.start()
    vi.advanceTimersByTime(45_000)
    const id = server(store).incidents[1]!.id
    await store.acknowledgeEscalation(id)
    expect(server(store).incidents.find((i) => i.id === id)!.escalationAcked).toBe(true)
    // v2 STATES.md: ack is "escalated -> escalated", timer not reset, and the
    // 60s auto-page is a separate side effect of the unattended state itself.
    vi.advanceTimersByTime(16_000)
    expect(server(store).pages.some((p) => !p.acknowledgedAt)).toBe(true)
    client.stop()
  })

  it('refuses to acknowledge a lane that is currently focused', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const id = server(store).incidents[0]!.id
    await store.acknowledgeEscalation(id)
    expect(server(store).incidents[0]!.escalationAcked).toBe(false)
  })
})

describe('named ladder: Talk-down / Siren / Keyholder / Dispatch (v2 STATES.md §3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts armed, not running — nothing fires before 30s', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    expect(server(store).incidents[0]!.ladder.status).toBe('armed')
    client.start()
    vi.advanceTimersByTime(29_000)
    expect(server(store).incidents[0]!.ladder.firedStage).toBe(-1)
    expect(server(store).incidents[0]!.ladder.status).toBe('armed')
    client.stop()
  })

  it('Talk-down fires at 30s and flips the ladder to running', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    client.start()
    vi.advanceTimersByTime(30_000)
    const l = server(store).incidents[0]!.ladder
    expect(l.firedStage).toBe(0)
    expect(l.status).toBe('running')
    client.stop()
  })

  it('Siren auto-arms at 45s without halting the ladder', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    client.start()
    vi.advanceTimersByTime(45_000)
    const inc = server(store).incidents[0]!
    expect(inc.siren).toBe(true)
    expect(inc.ladder.status).toBe('running') // not 'halted' — the ladder armed it, not the operator
    expect(inc.ladder.firedStage).toBe(1)
    client.stop()
  })

  it('Dispatch never fires on its own, even well past 60s', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    client.start()
    vi.advanceTimersByTime(120_000)
    const l = server(store).incidents[0]!.ladder
    expect(l.firedStage).toBe(2) // Keyholder, the last automatic stage
    expect(l.status).toBe('running') // still running, not 'complete' — no auto-dispatch
    client.stop()
  })

  it('confirmDispatch is available any time, not gated on Keyholder having fired', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const id = server(store).incidents[0]!.id
    expect(server(store).incidents[0]!.ladder.firedStage).toBe(-1)
    await store.confirmDispatch(id)
    const l = server(store).incidents[0]!.ladder
    expect(l.firedStage).toBe(3)
    expect(l.status).toBe('complete')
  })

  it('confirmDispatch works even on a suppressed ladder — suppression stops the automation, not the operator', async () => {
    const store = await boot()
    await store.openIncident('a3') // seeded with a suppressedReason
    const id = server(store).incidents[0]!.id
    expect(server(store).incidents[0]!.ladder.status).toBe('suppressed')
    await store.confirmDispatch(id)
    expect(server(store).incidents[0]!.ladder.status).toBe('complete')
  })

  it('a peripheral lane reaching Keyholder shows a toast naming the lane', async () => {
    const { store, client } = await bootWithClient()
    await store.openIncident('a1')
    await store.openIncident('a2') // peripheral — a1 keeps focus
    client.start()
    vi.advanceTimersByTime(60_000)
    expect(store.getState().ui.toast?.text).toMatch(/Lane B ladder reached Keyholder/)
    client.stop()
  })
})

describe('camera view and raising a lane without an AI alert (v2 Part 7)', () => {
  it('opening a camera view clears focus — breaks attention for every lane', async () => {
    const store = await boot()
    await store.openIncident('a1')
    expect(server(store).focusIncidentId).not.toBeNull()
    await store.openCameraView('07')
    expect(store.getState().ui.viewingCameraId).toBe('07')
    expect(server(store).focusIncidentId).toBeNull()
  })

  it('switching cameras while already viewing does not re-touch focus or the remembered lane', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const focusedId = server(store).focusIncidentId
    await store.openCameraView('07')
    await store.openCameraView('08') // same site, different camera
    expect(store.getState().ui.viewingCameraId).toBe('08')
    await store.closeCameraView()
    expect(server(store).focusIncidentId).toBe(focusedId) // still restores the original lane
  })

  it('closing camera view restores the lane that was focused before it opened', async () => {
    const store = await boot()
    await store.openIncident('a1')
    const focusedId = server(store).focusIncidentId
    await store.openCameraView('07')
    await store.closeCameraView()
    expect(store.getState().ui.viewingCameraId).toBeNull()
    expect(server(store).focusIncidentId).toBe(focusedId)
  })

  it('closing camera view with no lane to return to just clears it, no crash', async () => {
    const store = await boot()
    await store.openCameraView('07') // no incidents open at all
    await store.closeCameraView()
    expect(store.getState().ui.viewingCameraId).toBeNull()
    expect(server(store).focusIncidentId).toBeNull()
  })

  it('raises each priority exactly, with no AI alert behind it, and clears camera view', async () => {
    const store = await boot()
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) {
      const fresh = await boot()
      await fresh.raiseIncident('07', p)
      const inc = server(fresh).incidents[0]!
      const alert = server(fresh).alerts.find((a) => a.id === inc.alertId)!
      expect(derivePriority(alert)).toBe(p)
    }
    await store.openCameraView('07')
    await store.raiseIncident('07', 'P2')
    expect(store.getState().ui.viewingCameraId).toBeNull()
    expect(server(store).incidents.length).toBe(1)
  })

  it('refuses to raise a 4th lane, same lane-limit rule as the queue', async () => {
    const store = await boot()
    for (const id of ['a1', 'a2', 'a3']) await store.openIncident(id)
    await store.raiseIncident('07', 'P1')
    expect(server(store).incidents.length).toBe(3)
    expect(store.getState().ui.toast?.text).toMatch(/three lanes/i)
  })
})
