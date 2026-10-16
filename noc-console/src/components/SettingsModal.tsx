import { useEffect } from 'react'
import type { Theme, Typeface } from '../domain/appearance'
import { useRovingRadiogroup } from '../hooks/useRovingRadiogroup'
import { useStore, useUi } from '../store/context'

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
]
const TYPEFACES: { id: Typeface; label: string }[] = [
  { id: 'plex', label: 'IBM Plex' },
  { id: 'inter', label: 'Inter' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible' },
]

/**
 * v2 COMPONENTS.md#SettingsModal: theme + typeface only, radiogroups with
 * roving focus (`useRovingRadiogroup`), changes apply immediately and
 * persist per workstation (`domain/appearance.ts`). The OS theme preference
 * is intentionally never read — "control room": a shift shouldn't look
 * different because of someone's OS setting (UI-SPEC.md §7).
 */
export function SettingsModal() {
  const store = useStore()
  const ui = useUi()
  const themeKeyDown = useRovingRadiogroup(THEMES.map((t) => t.id), ui.theme, (t) => store.setTheme(t))
  const faceKeyDown = useRovingRadiogroup(TYPEFACES.map((t) => t.id), ui.typeface, (t) => store.setTypeface(t))

  useEffect(() => {
    if (!ui.settingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.settingsOpen, store])

  if (!ui.settingsOpen) return null

  return (
    <div className="modal-backdrop" onClick={() => store.setSettingsOpen(false)}>
      <div
        className="modal settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b id="settings-title">Settings</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.setSettingsOpen(false)}>✕</button>
        </div>
        <div className="modal-body">
          <div className="settings-field">
            <span className="ws-sub-h">Theme</span>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={ui.theme === t.id}
                  tabIndex={ui.theme === t.id ? 0 : -1}
                  className="seg-opt"
                  onClick={() => store.setTheme(t.id)}
                  onKeyDown={themeKeyDown}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span className="ws-sub-h">Typeface</span>
            <div className="seg" role="radiogroup" aria-label="Typeface">
              {TYPEFACES.map((t) => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={ui.typeface === t.id}
                  tabIndex={ui.typeface === t.id ? 0 : -1}
                  className="seg-opt"
                  onClick={() => store.setTypeface(t.id)}
                  onKeyDown={faceKeyDown}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
