import { useEffect, useState } from 'react'

/**
 * Wall-clock in ms, re-rendering the caller once per second. Use it only in the small
 * components that show running timers, so the rest of the tree does not re-render.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
