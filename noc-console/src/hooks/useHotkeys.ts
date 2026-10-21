import { useEffect } from 'react'
import { isTypingTarget } from '../domain/rules'
import { triggerArmHandle } from './useHoldToArm'
import { incidentsByLane, mostEscalatedIncident } from '../store/selectors'
import type { NocStore } from '../store/store'

/**
 * A/B/C focus a lane, M toggles the mic on the focused lane, H halts its ladder,
 * R resumes it, K acknowledges whichever lane's unattended escalation is
 * currently showing in the EscalationBar, W toggles the camera wall, Ctrl/⌘+K
 * opens the command palette, F1 opens Help (v2 UI-SPEC.md §6, STATES.md §10).
 * S/L hold-to-arm Siren/Strobe on the focused lane, single press disarms
 * (STATES.md §4's "single press" stop column) — found live that these were
 * visually promised by the buttons' own `<kbd>` hints but never actually
 * wired to the literal key, only to Enter/Space while the button itself had
 * focus; fixed via `useHoldToArm`'s registry so the same hook instance (and
 * its visual hold-fill) drives both input paths. Never fires while typing
 * (audit C1), with a modifier held, or while a modal is open — except the
 * palette and Help, which (like real command palettes and most apps' own
 * help key) open even from inside a text field; neither stacks over a
 * genuinely blocking flow (closeout, report, mic confirm).
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
      if (!e.repeat && e.key === 'F1') {
        e.preventDefault() // browsers rarely do anything with F1 themselves, but never let it leak out
        const { ui } = store.getState()
        if (ui.closingIncidentId || ui.report || ui.micConfirm) return
        store.setHelpOpen(!ui.helpOpen)
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
      else if (key === 's' || key === 'l') {
        const inc = lanes.find((i) => i.id === focus)
        if (!inc) return
        const armed = key === 's' ? inc.siren : inc.strobe
        if (armed) {
          // single press disarms (STATES.md §4) — never starts a hold
          if (key === 's') void store.setSiren(focus, false)
          else void store.setStrobe(focus, false)
        } else {
          triggerArmHandle(key === 's' ? 'siren' : 'strobe', 'start')
        }
      }
    }
    // Release before 600ms cancels the arm (no modal/typing guard needed:
    // cancelling a hold that isn't running is already a safe no-op).
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 's' || key === 'l') triggerArmHandle(key === 's' ? 'siren' : 'strobe', 'cancel')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [store])
}
