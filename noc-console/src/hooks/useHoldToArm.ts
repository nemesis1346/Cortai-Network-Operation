import { useCallback, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Siren and strobe arm on a 600ms hold, pointer or keyboard (v2 UI-SPEC.md
 * §5: "Holds: Siren and strobe arm on a 600ms hold (keyboard or pointer).
 * Releasing early cancels and nothing is sent."). Disarming is a plain click,
 * not a hold — handled by the caller, this hook only owns the arm gesture.
 *
 * `progress` (0..1) drives the visual fill; releasing before it reaches 1
 * cancels with no side effect, matching the spec exactly.
 *
 * Every pointerdown+pointerup on the same element also fires a trailing
 * native `click` — including the hold gesture that just armed the control.
 * Found live: without `justArmed()`, that trailing click reached the
 * caller's "disarm on click" handler and undid the arm within the same
 * gesture, so a successful 600ms hold appeared to do nothing. The caller
 * must check `justArmed()` at the top of its click handler and bail out if
 * it returns true, consuming the flag so the *next* real click still works.
 */
export function useHoldToArm(onArm: () => void, holdMs = 600) {
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const justArmedRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    timerRef.current = null
    rafRef.current = null
    setHolding(false)
    setProgress(0)
  }, [])

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current
    setProgress(Math.min(1, elapsed / holdMs))
    if (elapsed < holdMs) rafRef.current = requestAnimationFrame(tick)
  }, [holdMs])

  const start = useCallback(() => {
    if (timerRef.current !== null) return // already holding
    setHolding(true)
    startRef.current = Date.now()
    rafRef.current = requestAnimationFrame(tick)
    timerRef.current = window.setTimeout(() => {
      justArmedRef.current = true
      onArm()
      clear()
    }, holdMs)
  }, [onArm, holdMs, tick, clear])

  const cancel = useCallback(() => {
    if (timerRef.current === null) return
    clear()
  }, [clear])

  return {
    holding,
    progress,
    /** Call first in the element's onClick; returns true (and consumes the
     * flag) exactly once per successful hold, for the trailing click that
     * gesture itself generates. */
    justArmed: () => {
      if (!justArmedRef.current) return false
      justArmedRef.current = false
      return true
    },
    handlers: {
      onPointerDown: start,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onKeyDown: (e: KeyboardEvent) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          start()
        }
      },
      onKeyUp: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') cancel()
      },
    },
  }
}
