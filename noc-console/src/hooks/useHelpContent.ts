import { useEffect, useState } from 'react'
import type { HelpContent } from '../domain/help'

// HELP.md's loading contract: ship help/ as static assets, load help.json
// lazily, cache in memory, keep a version query for cache busting. Matches
// the content's own `version` field (help.json's header) — bump alongside
// a content update, same as the real prototype's house rule.
const HELP_URL = '/help/help.json?v=2.14'

let cached: HelpContent | null = null
let inflight: Promise<HelpContent> | null = null

function loadHelpContent(): Promise<HelpContent> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = fetch(HELP_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<HelpContent>
      })
      .then((data) => {
        cached = data
        return data
      })
      .catch((e: unknown) => {
        inflight = null // let a retry try again instead of replaying the same rejection forever
        throw e
      })
  }
  return inflight
}

export type HelpLoadState =
  | { status: 'idle' | 'loading'; content: null }
  | { status: 'ready'; content: HelpContent }
  | { status: 'error'; content: null }

/**
 * v2 HelpModal: "loaded on demand the first time Help opens... loading shows
 * skeletons; failure shows 'Help could not load' + Try again; the console
 * never depends on it." `enabled` gates the fetch to only happen once Help
 * is actually opened — importing this hook never triggers network activity
 * on its own.
 */
export function useHelpContent(enabled: boolean): HelpLoadState & { retry: () => void } {
  const [state, setState] = useState<HelpLoadState>(() =>
    cached ? { status: 'ready', content: cached } : { status: 'idle', content: null },
  )
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!enabled || state.status === 'ready') return
    let cancelled = false
    setState({ status: 'loading', content: null })
    loadHelpContent()
      .then((content) => {
        if (!cancelled) setState({ status: 'ready', content })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', content: null })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, retryTick])

  return { ...state, retry: () => setRetryTick((t) => t + 1) }
}
