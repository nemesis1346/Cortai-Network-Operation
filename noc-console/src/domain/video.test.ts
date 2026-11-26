import { describe, expect, it } from 'vitest'
import type { Camera } from '../api/types'
import { classifyPlayer, streamUrlFor, worseSignal } from './video'

const t0 = 1_000_000
const at = (ms: number, lastFrameAt: number | null, fps: number | null = 25) =>
  classifyPlayer({ now: t0 + ms, startedAt: t0, lastFrameAt: lastFrameAt === null ? null : t0 + lastFrameAt, fps })

describe('classifyPlayer (API-CONTRACT.md §7 thresholds)', () => {
  it('is connecting until the first frame, lost if none comes within 10s', () => {
    expect(at(0, null)).toBe('connecting')
    expect(at(9_999, null)).toBe('connecting')
    expect(at(10_000, null)).toBe('lost')
  })
  it('is live with recent frames at a healthy rate', () => {
    expect(at(2_000, 1_900, 25)).toBe('live')
    expect(at(2_000, 1_900, null)).toBe('live') // fps window not full yet
  })
  it('is degraded under 3 fps', () => {
    expect(at(2_000, 1_900, 2)).toBe('degraded')
    expect(at(2_000, 1_900, 3)).toBe('live')
  })
  it('is degraded after a frame gap over 900ms', () => {
    expect(at(2_000, 1_100)).toBe('live') // 900ms exactly
    expect(at(2_000, 1_099)).toBe('degraded')
  })
  it('is lost after 5s without a frame', () => {
    expect(at(10_000, 5_001)).toBe('degraded')
    expect(at(10_000, 5_000)).toBe('lost')
  })
})

describe('worseSignal', () => {
  it('keeps whichever side is worse', () => {
    expect(worseSignal('live', 'degraded')).toBe('degraded')
    expect(worseSignal('lost', 'live')).toBe('lost')
    expect(worseSignal('connecting', 'degraded')).toBe('connecting')
    expect(worseSignal('live', 'live')).toBe('live')
  })
})

describe('streamUrlFor', () => {
  const cam = (o: Partial<Camera>): Camera => ({ id: '07', siteId: 's1', name: 'Gate', status: 'live', ...o })
  it('uses the sub stream for small tiles, falling back to the main one', () => {
    expect(streamUrlFor(cam({ streamUrl: 'm', subStreamUrl: 's' }), 'sub')).toBe('s')
    expect(streamUrlFor(cam({ streamUrl: 'm' }), 'sub')).toBe('m')
    expect(streamUrlFor(cam({ streamUrl: 'm', subStreamUrl: 's' }), 'full')).toBe('m')
  })
  it('has nothing to play without a URL, so the placeholder stays', () => {
    expect(streamUrlFor(cam({}), 'full')).toBeUndefined()
    expect(streamUrlFor(undefined, 'full')).toBeUndefined()
  })
})

describe('mock seed with a go2rtc URL (video/go2rtc.yaml naming)', async () => {
  const { seedEstate } = await import('../api/mock/data')
  it('streams every camera with a signal, and none without a go2rtc', () => {
    const { cameras } = seedEstate(Date.now(), 'http://localhost:1984/')
    const cam07 = cameras.find((c) => c.id === '07')!
    expect(cam07.streamUrl).toBe('http://localhost:1984/api/webrtc?src=cam07')
    expect(cam07.subStreamUrl).toBe('http://localhost:1984/api/webrtc?src=cam07_sub')
    // Offline = no signal: nothing to play, placeholder stays.
    expect(cameras.filter((c) => c.status === 'offline').every((c) => !c.streamUrl)).toBe(true)
    expect(cameras.filter((c) => c.status !== 'offline').every((c) => c.streamUrl)).toBe(true)
    expect(seedEstate(Date.now()).cameras.some((c) => c.streamUrl)).toBe(false)
  })
})
