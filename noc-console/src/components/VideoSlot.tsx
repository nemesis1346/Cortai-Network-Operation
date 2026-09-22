export interface VideoSlotProps {
  cameraId: string
  /** full = focused lane, high quality. sub = unfocused, low-bandwidth stream. */
  tier: 'full' | 'sub'
}

/**
 * Placeholder for phase 1. This is the entire surface a real player needs:
 * it becomes a WebRTC (go2rtc) view behind the same two props, without the
 * rest of the lane knowing the difference.
 */
export function VideoSlot({ cameraId, tier }: VideoSlotProps) {
  return (
    <div className="video-slot" data-camera={cameraId} data-tier={tier}>
      <div className="video-slot-fallback" aria-hidden="true" />
    </div>
  )
}
