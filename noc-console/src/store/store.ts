import type { NocClient } from '../api/client'
import type { AlertState, CameraStatus, IncidentReport, NextStepId, ServerEvent, Snapshot } from '../api/types'
import * as appearance from '../domain/appearance'
import { laneLetter, type QueuePriority } from '../domain/rules'
import { applyEvent } from './reducer'

/** Client-only UI state. Never sent to the server. */
export interface UiState {
  queueTab: Exclude<AlertState, 'closed'>
  /** v2 deviations#4: segmented filter alongside the tabs, narrows the active
   * tab's rows to P1-P2 without replacing the New/Working/Held tabs Yassine
   * asked to keep (DECISIONS.md #4). */
  queuePriorityFilter: 'all' | 'high'
  wallOpen: boolean
  /** v2 COMPONENTS.md#CameraWall: segmented tabs with counts, 'all' default. */
  wallFilter: 'all' | CameraStatus
  /** v2 COMPONENTS.md#CameraWorkspace: camera with no incident, replaces the
   * lane workspace in Center while set. Breaks attention for all lanes
   * (STATES.md §2) — opening it calls setFocus(null), same as leaving a lane. */
  viewingCameraId: string | null
  /** The lane focused right before camera view opened, so "Back to lane"
   * (Esc) can restore it rather than falling back to the first open lane. */
  cameraViewReturnTo: string | null
  /** Refusal shown where the action happened (audit A20), persists until dismissed. */
  queueRefusal: string | null
  /** Waiting for the operator to confirm moving the mic. Replaces window.confirm (C7). */
  micConfirm: { targetIncidentId: string; fromIncidentId: string; then: 'mic' | 'focus' } | null
  closingIncidentId: string | null
  report: IncidentReport | null
  shortcutsOpen: boolean
  shiftReportOpen: boolean
  settingsOpen: boolean
  paletteOpen: boolean
  /** Mirrors what's actually applied to <html> (see `domain/appearance.ts`) so
   * the Settings radiogroups have something reactive to render as checked —
   * applying the attribute itself is a DOM side effect, not React state. */
  theme: appearance.Theme
  typeface: appearance.Typeface
  toast: { id: number; text: string; kind: 'info' | 'warn' } | null
}

export interface AppState {
  /** null until the first snapshot arrives. */
  server: Snapshot | null
  ui: UiState
}

const initialUi: UiState = {
  queueTab: 'new',
  queuePriorityFilter: 'all',
  wallOpen: false,
  wallFilter: 'all',
  viewingCameraId: null,
  cameraViewReturnTo: null,
  queueRefusal: null,
  micConfirm: null,
  closingIncidentId: null,
  report: null,
  shortcutsOpen: false,
  shiftReportOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  theme: appearance.getStoredTheme(),
  typeface: appearance.getStoredTypeface(),
  toast: null,
}

type Listener = () => void

/**
 * Minimal external store (works with useSyncExternalStore). Depends on NocClient only,
 * so replacing the mock with HTTP + WebSocket changes nothing in here.
 */
export class NocStore {
  private state: AppState = { server: null, ui: initialUi }
  private listeners = new Set<Listener>()
  private toastSeq = 0
  private unsubscribe: (() => void) | null = null

  constructor(private readonly client: NocClient) {}

  /* ---------- useSyncExternalStore contract ---------- */

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getState = (): AppState => this.state

  /* ---------- lifecycle ---------- */

  async connect(): Promise<void> {
    // Subscribe first so nothing emitted between snapshot and subscribe is lost.
    const buffered: Parameters<typeof applyEvent>[1][] = []
    let ready = false
    this.unsubscribe = this.client.subscribe((e) => {
      if (!ready) {
        buffered.push(e)
        return
      }
      this.setServer(applyEvent(this.state.server as Snapshot, e))
      this.notifyLadderAdvance(e)
    })
    let snap = await this.client.getSnapshot()
    for (const e of buffered) snap = applyEvent(snap, e)
    ready = true
    this.setServer(snap)
  }

  /**
   * v2 STATES.md §3: "A peripheral lane advancing to Keyholder or Dispatch
   * shows a toast naming the lane." Dispatch never fires on its own (operator
   * confirm only, and only reachable from the focused lane's own ladder
   * controls — never peripheral by construction), so only Keyholder applies
   * in practice. Checked after setServer so the toast reads the post-event
   * focusIncidentId, not stale state.
   */
  private notifyLadderAdvance(e: ServerEvent): void {
    if (e.type !== 'ladder.updated' || e.ladder.firedStage !== 2) return
    const s = this.state.server
    if (!s || s.focusIncidentId === e.ladder.incidentId) return
    const inc = s.incidents.find((i) => i.id === e.ladder.incidentId)
    if (inc) this.toast(`Lane ${laneLetter(inc)} ladder reached Keyholder`, 'warn')
  }

  disconnect(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /* ---------- commands (UI intent -> client) ---------- */

  async openIncident(alertId: string): Promise<void> {
    const r = await this.client.openIncident(alertId)
    if (!r.ok) {
      if (r.error.code === 'LANE_LIMIT') this.patchUi({ queueRefusal: r.error.message })
      else this.toast(r.error.message, 'warn')
      return
    }
    this.patchUi({ queueRefusal: null })
  }

  dismissRefusal(): void {
    this.patchUi({ queueRefusal: null })
  }

  /**
   * v2 CameraWorkspace: camera with no incident, swaps in for the lane
   * workspace. First open remembers the previously-focused lane (for "Back
   * to lane") and calls setFocus(null) — breaks attention for every lane,
   * same mechanism a focus switch already uses. Switching cameras within an
   * already-open view just swaps which one, no refocus/remember needed.
   */
  async openCameraView(cameraId: string): Promise<void> {
    if (this.state.ui.viewingCameraId === null) {
      this.patchUi({ cameraViewReturnTo: this.state.server?.focusIncidentId ?? null })
      await this.client.setFocus(null)
    }
    this.patchUi({ viewingCameraId: cameraId })
  }

  /** Esc / "Back to lane" — restores the lane that was focused before, if it's still open. */
  async closeCameraView(): Promise<void> {
    const returnTo = this.state.ui.cameraViewReturnTo
    this.patchUi({ viewingCameraId: null, cameraViewReturnTo: null })
    if (returnTo && this.state.server?.incidents.some((i) => i.id === returnTo)) {
      await this.client.setFocus(returnTo)
    }
  }

  /** Raise incident (I) from camera view — no AI alert behind it, the operator picks the priority. */
  async raiseIncident(cameraId: string, priority: QueuePriority): Promise<void> {
    const r = await this.client.raiseIncident(cameraId, priority)
    if (!r.ok) {
      this.toast(r.error.message, 'warn')
      return
    }
    this.patchUi({ viewingCameraId: null, cameraViewReturnTo: null })
  }

  async holdAlert(alertId: string): Promise<void> {
    const r = await this.client.holdAlert(alertId)
    if (!r.ok) this.toast(r.error.message, 'warn')
  }

  /** "Page second desk" from the lane-limit refusal (Yassine, 1 Oct). */
  async pageSecondDesk(): Promise<void> {
    const r = await this.client.requestDeskPage('Lane limit reached - operator requested second desk')
    if (!r.ok) {
      this.toast(r.error.message, 'warn')
      return
    }
    this.patchUi({ queueRefusal: null })
    this.toast('Desk 3 paged', 'info')
  }

  /** Focus a lane. If the mic is open elsewhere, ask first. */
  async requestFocus(incidentId: string): Promise<void> {
    const s = this.state.server
    if (!s || s.focusIncidentId === incidentId) return
    const owner = s.micOwnerIncidentId
    if (owner && owner !== incidentId) {
      this.patchUi({ micConfirm: { targetIncidentId: incidentId, fromIncidentId: owner, then: 'focus' } })
      return
    }
    await this.client.setFocus(incidentId)
  }

  /** M key or the Two-way talk button: bind if free, release if bound here, ask if bound elsewhere. */
  async toggleMic(incidentId: string): Promise<void> {
    const s = this.state.server
    if (!s) return
    if (s.micOwnerIncidentId === incidentId) {
      await this.client.bindMic(null)
      return
    }
    const r = await this.client.bindMic(incidentId)
    if (!r.ok && r.error.code === 'MIC_BUSY' && r.error.micOwnerIncidentId) {
      this.patchUi({
        micConfirm: { targetIncidentId: incidentId, fromIncidentId: r.error.micOwnerIncidentId, then: 'mic' },
      })
    }
  }

  async confirmMicMove(): Promise<void> {
    const c = this.state.ui.micConfirm
    if (!c) return
    this.patchUi({ micConfirm: null })
    if (c.then === 'mic') await this.client.bindMic(c.targetIncidentId, { force: true })
    else {
      await this.client.bindMic(null)
      await this.client.setFocus(c.targetIncidentId)
    }
  }

  cancelMicMove(): void {
    this.patchUi({ micConfirm: null })
  }

  haltLadder = (id: string) => this.client.haltLadder(id)
  resumeLadder = (id: string) => this.client.resumeLadder(id)
  confirmDispatch = (id: string) => this.client.confirmDispatch(id)
  setSiren = (id: string, on: boolean) => this.client.setSiren(id, on)
  setStrobe = (id: string, on: boolean) => this.client.setStrobe(id, on)
  acknowledgePage = (desk: number) => this.client.acknowledgePage(desk)
  acknowledgeEscalation = (incidentId: string) => this.client.acknowledgeEscalation(incidentId)

  async addNote(text: string): Promise<boolean> {
    const id = this.state.server?.focusIncidentId
    if (!id) {
      this.toast('Focus a lane before adding a note', 'warn')
      return false
    }
    const r = await this.client.addNote(id, text)
    if (!r.ok) this.toast(r.error.message, 'warn')
    return r.ok
  }

  /* ---------- closeout ---------- */

  openCloseout(incidentId: string): void {
    this.patchUi({ closingIncidentId: incidentId })
  }
  cancelCloseout(): void {
    this.patchUi({ closingIncidentId: null })
  }
  async submitCloseout(memo: string, nextSteps: NextStepId[]): Promise<boolean> {
    const id = this.state.ui.closingIncidentId
    if (!id) return false
    const r = await this.client.closeIncident(id, { memo, nextSteps })
    if (!r.ok) {
      this.toast(r.error.message, 'warn')
      return false
    }
    this.patchUi({ closingIncidentId: null, report: nextSteps.includes('report') ? r.value : null })
    return true
  }
  closeReport(): void {
    this.patchUi({ report: null })
  }

  /* ---------- plain UI state ---------- */

  setQueueTab(tab: UiState['queueTab']): void {
    this.patchUi({ queueTab: tab })
  }
  setQueuePriorityFilter(filter: UiState['queuePriorityFilter']): void {
    this.patchUi({ queuePriorityFilter: filter })
  }
  /**
   * v2 deviations#13: the wall stays available while incidents are open — the
   * brief's "locked while open" is gone. Open lanes keep counting unattended
   * time underneath it (the overlay only ever covered the centre column, not
   * the lane cards or EscalationBar). One of the two items Yassine wanted to
   * see on Figma first (DECISIONS.md, 5 Oct); building it per the deviations
   * table since the call isn't happening in a structured way.
   */
  toggleWall(): void {
    this.patchUi({ wallOpen: !this.state.ui.wallOpen })
  }
  setWallFilter(filter: UiState['wallFilter']): void {
    this.patchUi({ wallFilter: filter })
  }
  setShortcutsOpen(open: boolean): void {
    this.patchUi({ shortcutsOpen: open })
  }
  setShiftReportOpen(open: boolean): void {
    this.patchUi({ shiftReportOpen: open })
  }
  setSettingsOpen(open: boolean): void {
    this.patchUi({ settingsOpen: open })
  }
  setPaletteOpen(open: boolean): void {
    this.patchUi({ paletteOpen: open })
  }
  setTheme(theme: appearance.Theme): void {
    appearance.setTheme(theme)
    this.patchUi({ theme })
  }
  setTypeface(face: appearance.Typeface): void {
    appearance.setTypeface(face)
    this.patchUi({ typeface: face })
  }
  toast(text: string, kind: 'info' | 'warn' = 'info'): void {
    this.patchUi({ toast: { id: ++this.toastSeq, text, kind } })
  }
  dismissToast(id: number): void {
    if (this.state.ui.toast?.id === id) this.patchUi({ toast: null })
  }

  /* ---------- internals ---------- */

  private setServer(server: Snapshot): void {
    this.state = { ...this.state, server }
    this.emit()
  }
  private patchUi(p: Partial<UiState>): void {
    this.state = { ...this.state, ui: { ...this.state.ui, ...p } }
    this.emit()
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
}
