import type { Snapshot } from '../api/types'
import { laneLetter } from '../domain/rules'

/**
 * v2 COMPONENTS.md#StatusBar, replacing the old global VoiceStrip footer (v2
 * deviations#5: "Status bar shows mic and running sirens"). The rich,
 * per-incident view — waveform, last line, Move mic here — moved into the
 * focused lane as CommsDock; this stays minimal and always visible
 * regardless of focus, so a siren running on a lane you've stepped away from
 * is never silently invisible.
 */
export function StatusBar({ server }: { server: Snapshot }) {
  const micInc = server.micOwnerIncidentId ? server.incidents.find((i) => i.id === server.micOwnerIncidentId) : null
  const sirens = server.incidents.filter((i) => i.siren)

  return (
    <footer className="status-bar" aria-label="System status">
      <span className="sb-item">
        <u>Mic</u>
        <b>{micInc ? `Lane ${laneLetter(micInc)}` : 'Unbound'}</b>
      </span>
      <span className={`sb-item ${sirens.length ? 'crit' : ''}`}>
        <u>Sirens</u>
        <b>{sirens.length ? sirens.map((i) => laneLetter(i)).join(', ') : 'None running'}</b>
      </span>
    </footer>
  )
}
