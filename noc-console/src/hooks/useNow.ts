import { useSyncExternalStore } from 'react'

/**
 * One shared clock per interval, ticking on the wall-clock boundary.
 *
 * Point 5 (scale check) found the old version's cost: every caller ran its
 * own setInterval, started whenever it mounted. With 200 alerts in the queue
 * that's ~170 timers firing at ~170 different moments a second, each one a
 * separate React commit: ~60 commits a second with nothing happening
 * (docs/PERFORMANCE.md). Now every caller of the same interval shares one
 * timer, so all running clocks update in the same task and React renders
 * them in a single commit. Aligning to the boundary also means every clock
 * on screen turns over at the same instant.
 */
type Clock = { now: number; listeners: Set<() => void>; timer: ReturnType<typeof setTimeout> | null }
const clocks = new Map<number, Clock>()

function clockFor(intervalMs: number): Clock {
  let c = clocks.get(intervalMs)
  if (!c) {
    c = { now: Date.now(), listeners: new Set(), timer: null }
    clocks.set(intervalMs, c)
  }
  return c
}

function schedule(intervalMs: number, c: Clock): void {
  const wait = intervalMs - (Date.now() % intervalMs)
  c.timer = setTimeout(() => {
    c.now = Date.now()
    for (const l of c.listeners) l()
    if (c.listeners.size) schedule(intervalMs, c)
    else c.timer = null
  }, wait)
}

function subscribe(intervalMs: number, listener: () => void): () => void {
  const c = clockFor(intervalMs)
  c.listeners.add(listener)
  if (!c.timer) {
    c.now = Date.now()
    schedule(intervalMs, c)
  }
  return () => {
    c.listeners.delete(listener)
    if (!c.listeners.size && c.timer) {
      clearTimeout(c.timer)
      c.timer = null
    }
  }
}

/**
 * Wall-clock in ms, re-rendering the caller once per interval. Use it only in the small
 * components that show running timers, so the rest of the tree does not re-render.
 */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(subscriberFor(intervalMs), () => clockFor(intervalMs).now)
}

/** Stable per interval: a new function each render would make React
 * unsubscribe and resubscribe every time, restarting the shared timer. */
const subscribers = new Map<number, (l: () => void) => () => void>()
function subscriberFor(intervalMs: number): (l: () => void) => () => void {
  let s = subscribers.get(intervalMs)
  if (!s) {
    s = (l) => subscribe(intervalMs, l)
    subscribers.set(intervalMs, s)
  }
  return s
}
