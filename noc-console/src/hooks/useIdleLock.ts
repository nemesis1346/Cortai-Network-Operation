import { useEffect, useRef } from 'react'
import { IDLE_LOCK_MIN } from '../domain/constants'
import type { NocStore } from '../store/store'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const

/**
 * v2 lock screen (Yassine, 3 Nov, "idle lock, default 15 minutes"). Per the
 * lock-screen help article (the one thing it still gets right post-OTP):
 * auto-lock only fires with no lane open — a quiet lane you're genuinely
 * watching (no mouse/keyboard needed) must never lock you out of it.
 * `hasOpenLanes` is passed in rather than read here so this hook stays
 * store/snapshot-agnostic and easy to unit-test in isolation later.
 */
export function useIdleLock(store: NocStore, active: boolean, hasOpenLanes: boolean): void {
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    if (!active) return
    const mark = () => {
      lastActivity.current = Date.now()
    }
    // Reset the baseline on the way in — otherwise time spent locked (or
    // signed out) would count against the idle clock the instant it's
    // active again, re-locking before the operator does anything at all.
    mark()
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, mark, { passive: true })
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, mark)
    }
  }, [active])

  useEffect(() => {
    if (!active || hasOpenLanes) return
    const id = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_LOCK_MIN * 60_000) store.lock()
    }, 1000)
    return () => clearInterval(id)
  }, [store, active, hasOpenLanes])
}
