import { useEffect, useState, type RefObject } from 'react'
import type { VideoSignal } from '../api/types'
import { VIDEO_RETRY_MS } from '../domain/constants'
import { classifyPlayer } from '../domain/video'

const POLL_MS = 500
const FPS_WINDOW_MS = 1000
/** Most go2rtc answers come back well before this; ICE on localhost/LAN is fast. */
const ICE_GATHER_MAX_MS = 2000

/**
 * Plays a go2rtc WebRTC stream into `video` and reports its health.
 *
 * Signalling is go2rtc's plain HTTP exchange: POST the SDP offer to the
 * camera's `streamUrl` (`…/api/webrtc?src=<stream>`), get the SDP answer
 * back. Non-trickle: the offer is sent once ICE gathering is done (or after
 * 2s), so one request is the whole handshake.
 *
 * Health comes from the receiver's own stats, not from the connection
 * state: every 500 ms it reads `framesDecoded` and lets `classifyPlayer`
 * (domain/video.ts) map frames-per-second and the gap since the last frame
 * onto connecting / live / degraded / lost. 'lost' tears the connection down
 * and tries again after 3 s, through 'connecting'.
 *
 * Returns null when there's no URL: nothing to play, the caller keeps its
 * placeholder.
 */
export function useGo2rtcStream(url: string | undefined, video: RefObject<HTMLVideoElement | null>): VideoSignal | null {
  const [state, setState] = useState<VideoSignal | null>(url ? 'connecting' : null)

  useEffect(() => {
    if (!url) {
      setState(null)
      return
    }
    let disposed = false
    let pc: RTCPeerConnection | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const teardown = () => {
      if (poll) clearInterval(poll)
      poll = null
      pc?.close()
      pc = null
      if (video.current) video.current.srcObject = null
    }

    const fail = () => {
      if (disposed) return
      teardown()
      setState('lost')
      retry = setTimeout(() => void start(), VIDEO_RETRY_MS)
    }

    const start = async () => {
      if (disposed) return
      setState('connecting')
      const startedAt = Date.now()
      let lastFrameAt: number | null = null
      let lastDecoded = 0
      const samples: { t: number; decoded: number }[] = []

      const conn = new RTCPeerConnection()
      pc = conn
      conn.addTransceiver('video', { direction: 'recvonly' })
      conn.ontrack = (e) => {
        const el = video.current
        if (!el) return
        el.srcObject = e.streams[0] ?? new MediaStream([e.track])
        void el.play().catch(() => {}) // muted + playsInline, so autoplay is allowed
      }
      conn.onconnectionstatechange = () => {
        // 'disconnected' can recover on its own; the frame watchdog decides.
        if (conn.connectionState === 'failed') fail()
      }

      poll = setInterval(async () => {
        if (pc !== conn) return
        let decoded = lastDecoded
        try {
          const stats = await conn.getStats()
          stats.forEach((r: { type?: string; kind?: string; framesDecoded?: number }) => {
            if (r.type === 'inbound-rtp' && r.kind === 'video' && typeof r.framesDecoded === 'number') decoded = r.framesDecoded
          })
        } catch {
          return
        }
        const now = Date.now()
        if (decoded > lastDecoded) {
          lastDecoded = decoded
          lastFrameAt = now
        }
        samples.push({ t: now, decoded })
        while (samples.length > 1 && now - samples[0]!.t > FPS_WINDOW_MS) samples.shift()
        const span = now - samples[0]!.t
        const fps = span >= FPS_WINDOW_MS * 0.9 ? ((decoded - samples[0]!.decoded) * 1000) / span : null
        const s = classifyPlayer({ now, startedAt, lastFrameAt, fps })
        if (s === 'lost') fail()
        else setState(s)
      }, POLL_MS)

      try {
        await conn.setLocalDescription(await conn.createOffer())
        await iceGathered(conn)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: conn.localDescription?.sdp ?? '',
        })
        if (!res.ok) throw new Error(`go2rtc answered ${res.status}`)
        const sdp = await res.text()
        if (pc !== conn) return // torn down while waiting
        await conn.setRemoteDescription({ type: 'answer', sdp })
      } catch {
        if (pc === conn) fail()
      }
    }

    void start()
    return () => {
      disposed = true
      if (retry) clearTimeout(retry)
      teardown()
    }
  }, [url, video])

  return state
}

function iceGathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      clearTimeout(timer)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    const timer = setTimeout(done, ICE_GATHER_MAX_MS)
    pc.addEventListener('icegatheringstatechange', check)
  })
}
