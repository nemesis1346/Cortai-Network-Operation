/**
 * End to end over the wire: the real HttpNocClient and NocStore against the
 * stub server, on a random port, over actual HTTP and WebSocket. Yassine's
 * point 3: full flow over http, idempotent take/close, and a stub restart
 * that shows offline then resyncs without the store being rebuilt (the test's
 * stand-in for "without a page reload").
 */
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { HttpNocClient, HttpNocError, type SocketLike } from '../src/api/http/HttpNocClient.ts'
import { NocStore } from '../src/store/store.ts'
import { startStub, type Stub } from './stub.ts'

const MEMO = 'Same white sedan as Tuesday, left after announcement.'

/** What the browser does for free: keep cookies, send them on fetch and on the socket upgrade. */
function wire(port: number) {
  const jar = new Map<string, string>()
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const fetchWithJar: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    if (jar.size) headers.set('cookie', cookieHeader())
    const res = await fetch(input, { ...init, headers })
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';')
      const [k, v = ''] = pair!.split('=')
      if (!v || attrs.some((a) => a.trim() === 'Max-Age=0')) jar.delete(k!.trim())
      else jar.set(k!.trim(), v)
    }
    return res
  }
  const client = new HttpNocClient({
    baseUrl: `http://localhost:${port}/api`,
    eventsUrl: `ws://localhost:${port}/api/events`,
    fetch: fetchWithJar,
    createSocket: (url) => new WebSocket(url, { headers: { cookie: cookieHeader() } }) as unknown as SocketLike,
    reconnect: { minMs: 50, maxMs: 200 },
    retryDelaysMs: [50, 100],
  })
  return { client, jar, fetch: fetchWithJar }
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function signIn(store: NocStore) {
  expect((await store.requestCode('op@example.com')).ok).toBe(true)
  const v = await store.verifyCode('op@example.com', '123456')
  if (!v.ok) throw new Error(v.error.message)
  const d = await store.selectDesk(v.value.operator.desks[0]!, v.value.operator, 'op@example.com')
  expect(d.ok).toBe(true)
}

let stubs: Stub[] = []
let stores: NocStore[] = []
async function boot(port = 0) {
  const stub = await startStub({ port, tick: false })
  stubs.push(stub)
  return stub
}
afterEach(async () => {
  for (const s of stores) s.disconnect()
  for (const s of stubs) await s.close()
  stubs = []
  stores = []
})

describe('HttpNocClient against the stub', () => {
  it('refuses the snapshot and the socket without a session (§2e)', async () => {
    const stub = await boot()
    const { client } = wire(stub.port)
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(client.getSnapshot()).rejects.toBeInstanceOf(HttpNocError)
    const r = await client.openIncident('a1')
    expect(!r.ok && r.error.code).toBe('UNAUTHENTICATED')
  })

  it('passes error codes and detail straight through (§2a)', async () => {
    const stub = await boot()
    const { client } = wire(stub.port)
    const wrong = await client.verifyCode('op@example.com', '999999')
    expect(wrong).toMatchObject({ ok: false, error: { code: 'INVALID_CODE', attemptsLeft: 2 } })
    expect(await client.requestCode('op@example.com')).toMatchObject({ ok: true, value: { resendAfterSec: 30 } })
    expect(await client.requestCode('op@example.com')).toMatchObject({ ok: false, error: { code: 'RESEND_TOO_SOON' } })
    const desk = await client.selectDesk(2)
    expect(!desk.ok && desk.error.code).toBe('INVALID_STATE') // no verified code yet
  })

  it('runs the full flow over the wire: sign in, take, close, Record, History', async () => {
    const stub = await boot()
    const { client } = wire(stub.port)
    const store = new NocStore(client, { connectAfterSignIn: true })
    stores.push(store)
    expect(store.getState().server).toBeNull()

    await signIn(store)
    expect(store.getState().server?.alerts.length).toBeGreaterThan(0)

    await store.openIncident('a1')
    await until(() => store.getState().server!.incidents.length === 1) // arrived as socket events
    const id = store.getState().server!.incidents[0]!.id

    store.openCloseout(id)
    expect(await store.submitCloseout(MEMO, ['police'])).toBe(true)
    await until(() => store.getState().server!.incidents.length === 0)
    const s = store.getState().server!
    expect(s.alerts.find((a) => a.id === 'a1')?.state).toBe('closed')
    expect(s.closedThisShift[0]?.incidentId).toBe(id)
    expect(store.getState().ui.record?.incident.id).toBe(id)

    const rec = await client.getRecord(id)
    expect(rec.ok && rec.value.incident.memo).toBe(MEMO)

    // Sign-out drops the connection and the snapshot with it.
    await store.signOut()
    expect(store.getState().server).toBeNull()
    await expect(client.getSnapshot()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('replays a retried take and close instead of re-running them (§6)', async () => {
    const stub = await boot()
    const { client, fetch: f } = wire(stub.port)
    const store = new NocStore(client, { connectAfterSignIn: true })
    stores.push(store)
    await signIn(store)

    const post = (path: string, body: unknown, key: string) =>
      f(`http://localhost:${stub.port}/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
      })

    const first = await post('/incidents', { alertId: 'a1' }, 'take-1')
    const again = await post('/incidents', { alertId: 'a1' }, 'take-1')
    expect(again.headers.get('Idempotent-Replayed')).toBe('true')
    const a = await first.json()
    expect(await again.json()).toEqual(a)
    expect((await stub.mock.getSnapshot()).incidents.length).toBe(1)

    const id = a.value.id as string
    const close1 = await post(`/incidents/${id}/close`, { memo: MEMO, nextSteps: [] }, 'close-1')
    const close2 = await post(`/incidents/${id}/close`, { memo: MEMO, nextSteps: [] }, 'close-1')
    expect(close1.status).toBe(200)
    // Without the replay this second close would be NOT_FOUND (the lane is gone).
    expect(close2.status).toBe(200)
    expect(close2.headers.get('Idempotent-Replayed')).toBe('true')
    expect((await stub.mock.getSnapshot()).closedThisShift.length).toBe(1)

    // A new key is a new action: the closed alert is refused (§15a).
    const retake = await post('/incidents', { alertId: 'a1' }, 'take-2')
    expect(retake.status).toBe(409)
    expect((await retake.json()).error.code).toBe('INVALID_STATE')
  })

  it('goes offline when the stub stops, and resyncs when it restarts, same store', async () => {
    const stub = await boot()
    const port = stub.port
    const { client } = wire(port)
    const store = new NocStore(client, { connectAfterSignIn: true })
    stores.push(store)
    await signIn(store)
    await store.openIncident('a1')
    await until(() => store.getState().server!.incidents.length === 1)

    await stub.close()
    stubs = stubs.filter((s) => s !== stub)
    await until(() => store.getState().connection.status === 'offline')

    // Site actions are refused while offline, never queued.
    await store.openIncident('a2')
    expect(store.getState().ui.toast?.text).toMatch(/offline/i)

    // A restarted stub is a fresh shift: the resync must show *its* state,
    // not the store's stale copy (one open incident before the drop).
    await boot(port)
    await until(() => store.getState().connection.status === 'online')
    expect(store.getState().server!.incidents.length).toBe(0)

    // And live events flow again on the new socket.
    await store.openIncident('a2')
    await until(() => store.getState().server!.incidents.length === 1)
  })
})
