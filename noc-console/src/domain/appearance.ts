/**
 * v2 SettingsModal: Dark/Light theme + 3 typefaces, applied as `data-theme`/
 * `data-typeface` on <html> (tokens.css reads them) and persisted per
 * workstation in localStorage under the exact keys the v2 prototype uses
 * (UI-SPEC.md §7: `sentry.theme.v2`, `sentry.face`) — not renamed, so a
 * workstation that ever runs the real prototype and this build side by side
 * shares the same stored preference instead of each silently ignoring the
 * other's key.
 *
 * Guards every browser global: `store.ts` reads `getStoredTheme`/
 * `getStoredTypeface` at module-eval time to seed its initial UI state, and
 * the unit test suite runs in a plain Node environment (`vite.config.ts`,
 * deliberately — the domain/store layer is meant to stay DOM-free for fast,
 * headless tests). Without the guards, importing `store.ts` under Node would
 * crash before a single test could run.
 */
export type Theme = 'dark' | 'light'
export type Typeface = 'plex' | 'inter' | 'atkinson'

const THEME_KEY = 'sentry.theme.v2'
const FACE_KEY = 'sentry.face'

/** Newer Node ships a global `localStorage` getter that itself throws
 * (`--localstorage-file` required) rather than being simply undefined, so a
 * bare `typeof localStorage` check isn't enough — probe it inside a
 * try/catch (Yassine, 26 Oct: 2 unit-test files crashed on Node 24/25). */
function detectStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.getItem('__probe__')
    return true
  } catch {
    return false
  }
}

const hasStorage = detectStorage()
const hasDocument = typeof document !== 'undefined'

export function getStoredTheme(): Theme {
  if (!hasStorage) return 'dark'
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
}

export function getStoredTypeface(): Typeface {
  if (!hasStorage) return 'plex'
  const v = localStorage.getItem(FACE_KEY)
  return v === 'inter' || v === 'atkinson' ? v : 'plex'
}

function applyTheme(theme: Theme): void {
  if (!hasDocument) return
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')
}

function applyTypeface(face: Typeface): void {
  if (!hasDocument) return
  if (face === 'plex') document.documentElement.removeAttribute('data-typeface')
  else document.documentElement.setAttribute('data-typeface', face)
}

export function setTheme(theme: Theme): void {
  if (hasStorage) localStorage.setItem(THEME_KEY, theme)
  applyTheme(theme)
}

export function setTypeface(face: Typeface): void {
  if (hasStorage) localStorage.setItem(FACE_KEY, face)
  applyTypeface(face)
}

/** Call once at boot, before the first paint, so there's no flash of the
 * wrong theme/typeface while React spins up. */
export function applyStoredAppearance(): void {
  applyTheme(getStoredTheme())
  applyTypeface(getStoredTypeface())
}
