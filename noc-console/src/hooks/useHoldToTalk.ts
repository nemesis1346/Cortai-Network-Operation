import { useCallback, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Press-and-hold talk, release to stop (v2 STATES.md §4: "Talk-down | hold
 * Space / hold button | release" — no 600ms arming delay, unlike siren/strobe;
 * see `useHoldToArm` for that one). `pressing` is purely local, immediate UI
 * feedback; `onStart` fires once per press so the caller can decide whether a
 * press needs a server round-trip (e.g. claiming the mic) or not.
 */
export function useHoldToTalk(onStart: () => void) {
  const [pressing, setPressing] = useState(false)
  const activeRef = useRef(false)

  const start = useCallback(() => {
    if (activeRef.current) return
    activeRef.current = true
    setPressing(true)
    onStart()
  }, [onStart])

  const stop = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    setPressing(false)
  }, [])

  return {
    pressing,
    handlers: {
      onPointerDown: start,
      onPointerUp: stop,
      onPointerLeave: stop,
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === ' ' && !e.repeat) {
          e.preventDefault()
          start()
        }
      },
      onKeyUp: (e: KeyboardEvent) => {
        if (e.key === ' ') stop()
      },
    },
  }
}
