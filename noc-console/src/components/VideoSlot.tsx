import { useRef } from 'react'
import type { Detection, VideoSignal } from '../api/types'
import { worseSignal } from '../domain/video'
import { useGo2rtcStream } from '../hooks/useGo2rtcStream'

export interface VideoSlotProps {
  cameraId: string
  /** full = focused lane, high quality. sub = unfocused, low-bandwidth stream. */
  tier: 'full' | 'sub'
  /** go2rtc WebRTC endpoint for this tier (`streamUrlFor(camera, tier)`).
   * Absent: nothing to play, the placeholder stays. */
  streamUrl?: string
  /** Stream health as the server (or the connection) sees it. When there's a
   * stream, the player's own view is combined with it and the worse wins. */
  signal?: VideoSignal
  /** Glass-to-glass latency in ms, shown in the corner OSD when known. */
  latencyMs?: number
  /** AI detections for the current frame, drawn as boxes. */
  detections?: Detection[]
}

const NON_LIVE_LABEL: Record<Exclude<VideoSignal, 'live'>, string> = {
  lost: 'Paused · offline',
  degraded: 'Degraded',
  connecting: 'Reconnecting…',
}

/**
 * The camera's live picture: a go2rtc WebRTC stream when the camera has a
 * `streamUrl` (useGo2rtcStream), the striped placeholder when it doesn't.
 * Owns its own bounding-box overlay, so the lane doesn't need to know how
 * detections are drawn, only that they exist.
 *
 * Signal: with a stream, the worse of `signal` (server / connection) and the
 * player's own state (connecting / live / degraded / lost, from decoded
 * frames). Without one, `signal` as given, 'live' by default.
 */
export function VideoSlot({ cameraId, tier, streamUrl, signal = 'live', latencyMs, detections = [] }: VideoSlotProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useGo2rtcStream(streamUrl, videoRef)
  const shown = player ? worseSignal(signal, player) : signal

  return (
    <div
      className="video-slot"
      data-camera={cameraId}
      data-tier={tier}
      data-signal={shown}
      data-player={player ?? 'none'}
    >
      <div className="video-slot-fallback" aria-hidden="true" />
      {streamUrl && <video ref={videoRef} className="video-slot-media" muted playsInline autoPlay aria-label={`Camera ${cameraId} live`} />}
      {shown !== 'live' && <span className="tag mono video-signal-tag">{NON_LIVE_LABEL[shown]}</span>}
      {shown === 'live' &&
        detections.map((d) => (
          <div
            key={`${d.label}-${d.box.join(',')}`}
            className="bbox"
            style={{
              left: `${d.box[0] * 100}%`,
              top: `${d.box[1] * 100}%`,
              width: `${d.box[2] * 100}%`,
              height: `${d.box[3] * 100}%`,
            }}
          >
            <b>{d.label} {d.confidence.toFixed(2)}</b>
          </div>
        ))}
      {shown === 'live' && latencyMs != null && <span className="tag mono video-latency">{latencyMs} ms</span>}
    </div>
  )
}
