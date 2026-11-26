import type { Camera, VideoSignal } from '../api/types'
import {
  VIDEO_DEGRADED_FPS,
  VIDEO_DEGRADED_GAP_MS,
  VIDEO_FIRST_FRAME_TIMEOUT_MS,
  VIDEO_LOST_MS,
} from './constants'

/** What the player has observed so far, sampled from RTCPeerConnection stats. */
export interface PlayerSample {
  now: number
  /** When the current connection attempt started. */
  startedAt: number
  /** When the decoded-frame count last went up; null if no frame yet. */
  lastFrameAt: number | null
  /** Decoded frames per second over the last ~1s window; null until the window is long enough. */
  fps: number | null
}

/**
 * Player state from what it has observed, per API-CONTRACT.md §7: degraded
 * under 3 fps or after a 900 ms frame gap, lost after 5 s without a frame
 * (or no first frame within 10 s of connecting). Pure, so it's testable
 * without a browser; useGo2rtcStream feeds it every 500 ms.
 */
export function classifyPlayer({ now, startedAt, lastFrameAt, fps }: PlayerSample): VideoSignal {
  if (lastFrameAt === null) return now - startedAt >= VIDEO_FIRST_FRAME_TIMEOUT_MS ? 'lost' : 'connecting'
  const gap = now - lastFrameAt
  if (gap >= VIDEO_LOST_MS) return 'lost'
  if (gap > VIDEO_DEGRADED_GAP_MS || (fps !== null && fps < VIDEO_DEGRADED_FPS)) return 'degraded'
  return 'live'
}

const RANK: Record<VideoSignal, number> = { live: 0, degraded: 1, connecting: 2, lost: 3 }

/** The worse of two signals: the server's view of the camera and the
 * player's own view of the stream can each be the one that knows better. */
export function worseSignal(a: VideoSignal, b: VideoSignal): VideoSignal {
  return RANK[a] >= RANK[b] ? a : b
}

/** Which URL a slot plays: the sub stream for small tiles if there is one. */
export function streamUrlFor(camera: Camera | undefined, tier: 'full' | 'sub'): string | undefined {
  if (!camera) return undefined
  return tier === 'sub' ? (camera.subStreamUrl ?? camera.streamUrl) : camera.streamUrl
}
