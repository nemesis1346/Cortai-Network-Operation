import { useRef } from 'react'

/**
 * Returns the previous array when the new one has the same items in the same
 * order (by identity). Point 5: a lane's filtered ledger/transcript is a new
 * array on every server event, even when the event was for another lane, so
 * memoised children re-rendered anyway. Cheap: one length check, then one
 * identity check per item, and only when the length matches.
 */
export function useStableArray<T>(next: T[]): T[] {
  const prev = useRef(next)
  const p = prev.current
  if (p !== next && (p.length !== next.length || p.some((x, i) => x !== next[i]))) prev.current = next
  return prev.current
}
