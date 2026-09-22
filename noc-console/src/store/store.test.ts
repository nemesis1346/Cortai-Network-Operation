import { describe, expect, it } from 'vitest'
import { MockNocClient } from '../api/mock/MockNocClient'
import { alertCounts } from './selectors'
import { NocStore } from './store'

async function boot() {
  const client = new MockNocClient()
  const store = new NocStore(client)
  await store.connect()
  return store
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
})
