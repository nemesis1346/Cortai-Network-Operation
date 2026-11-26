import { describe, expect, it } from 'vitest'
import { MockNocClient } from './MockNocClient'
import { makeBurst, rng, seedLoad } from './loadFixture'

describe('load fixture (point 5, docs/PERFORMANCE.md)', () => {
  const now = Date.parse('2026-11-26T02:00:00Z')

  it("matches Yassine's spec: 40+ cameras, 200 alerts in the queue", () => {
    const { cameras, alerts, sites } = seedLoad(now, 1)
    expect(cameras.length).toBeGreaterThanOrEqual(40)
    expect(alerts.length).toBe(200)
    expect(alerts.every((a) => a.state === 'new' || a.state === 'held')).toBe(true)
    expect(new Set(cameras.map((c) => c.id)).size).toBe(cameras.length)
    expect(alerts.every((a) => sites.some((s) => s.id === a.siteId) && cameras.some((c) => c.id === a.cameraId))).toBe(true)
  })

  it('is deterministic: same seed, same data; different seed, different data', () => {
    expect(seedLoad(now, 1)).toEqual(seedLoad(now, 1))
    expect(seedLoad(now, 1).alerts).not.toEqual(seedLoad(now, 2).alerts)
  })

  it('produces the same bursts for the same seed, of the requested size', async () => {
    const snap = await new MockNocClient({ now, fixture: { seed: 1, burstSize: 50 } }).getSnapshot()
    const kinds = (seed: number) => makeBurst(rng(seed), snap, 50, { n: 0 }).map((e) => e.type)
    expect(kinds(7)).toEqual(kinds(7))
    expect(kinds(7).length).toBeLessThanOrEqual(50)
    expect(kinds(7).length).toBeGreaterThan(40) // lane events skip with no lanes open
  })

  it('opens 3 lanes and emits a burst per tick through the normal event path', async () => {
    const mock = new MockNocClient({ fixture: { seed: 1, burstSize: 50 } })
    const waiting = (await mock.getSnapshot()).alerts.filter((a) => a.state === 'new').slice(0, 3)
    for (const a of waiting) await mock.openIncident(a.id)
    expect((await mock.getSnapshot()).incidents.length).toBe(3)
    const seen: string[] = []
    mock.subscribe((e) => seen.push(e.type))
    mock.start()
    await new Promise((r) => setTimeout(r, 1100))
    mock.stop()
    expect(seen.length).toBeGreaterThanOrEqual(50)
  })
})
