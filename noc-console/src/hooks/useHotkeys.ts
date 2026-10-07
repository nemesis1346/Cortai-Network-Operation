import { useEffect } from 'react'
import { isTypingTarget } from '../domain/rules'
import { incidentsByLane, mostEscalatedIncident } from '../store/selectors'
import type { NocStore } from '../store/store'

/**
 * A/B/C focus a lane, M toggles the mic on the focused lane, H halts its ladder,
 * R resumes it, K acknowledges whichever lane's unattended escalation is
 * currently showing in the EscalationBar (v2 UI-SPEC.md §6). Never fires while
 * typing (audit C1), with a modifier held, or while a modal is open.
 */
export function useHotkeys(store: NocStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
