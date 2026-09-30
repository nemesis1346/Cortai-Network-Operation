import type { Detection, VideoSignal } from '../api/types'

export interface VideoSlotProps {
  cameraId: string
  /** full = focused lane, high quality. sub = unfocused, low-bandwidth stream. */
  tier: 'full' | 'sub'
  /** Stream health. Phase 1 never produces anything but 'live' — see the type's
   * own doc comment in api/types.ts for why it's threaded through anyway. */
  signal?: VideoSignal
  /** Glass-to-glass latency in ms, shown in the corner OSD when known. */
  latencyMs?: number
  /** AI detections for the current frame, drawn as boxes. */
  detections?: Detection[]
}

/**
 * Placeholder for phase 1, but the full surface a real WebRTC (go2rtc) player
 * needs: camera id, quality tier, signal health, latency and live detections.
 * Owns its own bounding-box overlay — that used to be hardcoded in the parent
 * lane — so the lane doesn't need to know how detections are drawn, only that
 * they exist.
 */
export function VideoSlot({ cameraId, tier, signal = 'live', latencyMs, detections = [] }: VideoSlotProps) {
  return (
    <div className="video-slot" data-camera={cameraId} data-tier={tier} data-signal={signal}>
      <div className="video-slot-fallback" aria-hidden="true" />
      {signal === 'live' &&
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
      {signal === 'live' && latencyMs != null && <span className="tag mono video-latency">{latencyMs} ms</span>}
    </div>
  )
}
