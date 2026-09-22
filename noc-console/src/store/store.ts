import type { NocClient } from '../api/client'
import type { AlertState, IncidentReport, NextStepId, Snapshot } from '../api/types'
import { applyEvent } from './reducer'

/** Client-only UI state. Never sent to the server. */
export interface UiState {
  queueTab: Exclude<AlertState, 'closed'>
  wallOpen: boolean
  /** Refusal shown where the action happened (audit A20), persists until dismissed. */
  queueRefusal: string | null
  /** Waiting for the operator to confirm moving the mic. Replaces window.confirm (C7). */
  micConfirm: { targetIncidentId: string; fromIncidentId: string; then: 'mic' | 'focus' } | null
  closingIncidentId: string | null
  report: IncidentReport | null
  shortcutsOpen: boolean
  toast: { id: number; text: string; kind: 'info' | 'warn' } | null
}

export interface AppState {
  /** null until the first snapshot arrives. */
  server: Snapshot | null
  ui: UiState
}

const initialUi: UiState = {
  queueTab: 'new',
  wallOpen: false,
  queueRefusal: null,
  micConfirm: null,
  closingIncidentId: null,
  report: null,
  shortcutsOpen: false,
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
      if (!ready) buffered.push(e)
      else this.setServer(applyEvent(this.state.server as Snapshot, e))
    })
    let snap = await this.client.getSnapshot()
    for (const e of buffered) snap = applyEvent(snap, e)
    ready = true
    this.setServer(snap)
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
  setSiren = (id: string, on: boolean) => this.client.setSiren(id, on)
  setStrobe = (id: string, on: boolean) => this.client.setStrobe(id, on)
  acknowledgePage = (desk: number) => this.client.acknowledgePage(desk)

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
  toggleWall(): void {
    const s = this.state.server
    if (s && s.incidents.length) {
      this.toast('Wall stays collapsed while incidents are open. Close an incident to open it.', 'warn')
      return
    }
    this.patchUi({ wallOpen: !this.state.ui.wallOpen })
  }
  setShortcutsOpen(open: boolean): void {
    this.patchUi({ shortcutsOpen: open })
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
