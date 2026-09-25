import { useEffect } from 'react'
import { useStore, useUi } from '../store/context'

const SHORTCUTS: [string, string][] = [
  ['A / B / C', 'Focus lane A, B or C'],
  ['M', 'Open or close the microphone on the focused lane'],
  ['H', 'Halt the voice ladder on the focused lane'],
  ['Esc', 'Close the open dialog, keeping any memo you typed'],
  ['?', 'Show this legend'],
]

/** Never shown anywhere in the mockup (audit A6) — the A/B key badges read
 * as identifiers, not hints, with nothing explaining M or H exist at all. */
export function ShortcutsLegend() {
  const store = useStore()
  const ui = useUi()

  useEffect(() => {
    if (!ui.shortcutsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.setShortcutsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.shortcutsOpen, store])

  if (!ui.shortcutsOpen) return null
  return (
    <div className="modal-backdrop" onClick={() => store.setShortcutsOpen(false)}>
      <div
        className="modal confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b id="sc-title">Keyboard shortcuts</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.setShortcutsOpen(false)}>✕</button>
        </div>
        <div className="modal-body">
          <table className="sc-table">
            <tbody>
              {SHORTCUTS.map(([key, desc]) => (
                <tr key={key}>
                  <td className="mono">{key}</td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
