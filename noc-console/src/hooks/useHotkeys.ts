import { useEffect } from 'react'
import { isTypingTarget } from '../domain/rules'
import { incidentsByLane, mostEscalatedIncident } from '../store/selectors'
import type { NocStore } from '../store/store'

/**
 * A/B/C focus a lane, M toggles the mic on the focused lane, H halts its ladder,
 * R resumes it, K acknowledges whichever lane's unattended escalation is
 * currently showing in the EscalationBar, W toggles the camera wall, Ctrl/⌘+K
 * opens the command palette (v2 UI-SPEC.md §6). Never fires while typing
 * (audit C1), with a modifier held, or while a modal is open — except the
 * palette itself, which (like real command palettes generally) opens even
 * from inside a text field; it still won't stack over a genuinely blocking
 * flow (closeout, report, mic confirm).
 */
export function useHotkeys(store: NocStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault() // stop the browser's own Ctrl/Cmd+K (address bar search) either way
        const { ui } = store.getState()
        if (ui.closingIncidentId || ui.report || ui.micConfirm) return
        store.setPaletteOpen(!ui.paletteOpen)
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (isTypingTarget(e.target)) return
      const { server, ui } = store.getState()
      if (!server || ui.closingIncidentId || ui.report || ui.micConfirm || ui.shortcutsOpen) return

      const lanes = incidentsByLane(server)
      const key = e.key.toLowerCase()
      const laneIdx = ['a', 'b', 'c'].indexOf(key)
      if (laneIdx !== -1) {
        const inc = lanes.find((i) => i.laneIndex === laneIdx)
        if (inc) void store.requestFocus(inc.id)
        return
      }
      if (key === 'k') {
        const escalating = mostEscalatedIncident(server, Date.now())
        if (escalating) void store.acknowledgeEscalation(escalating.id)
        return
      }
      if (key === '?') {
        store.setShortcutsOpen(true)
        return
      }
      if (key === 'w') {
        store.toggleWall()
        return
      }
      const focus = server.focusIncidentId
      if (!focus) return
      if (key === 'm') void store.toggleMic(focus)
      else if (key === 'h') void store.haltLadder(focus)
      else if (key === 'r') void store.resumeLadder(focus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
