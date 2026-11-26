import type { NocClient } from '../api/client'
import type {
  AlertState,
  AuthOperator,
  AuthSession,
  CameraStatus,
  ConnectionState,
  IncidentReport,
  NextStepId,
  Result,
  ServerEvent,
  Snapshot,
} from '../api/types'
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
  /** Sealed at close — every close produces one (Part 9 decision note #2),
   * not just closes where a 'report' step used to be ticked. */
  record: IncidentReport | null
  /** History (Part 9): browses `server.closedThisShift`; its own filters/
   * search are local component state, not store state — they're a pure
   * view over already-fetched data, same reasoning as CloseoutModal's
   * local `steps`. */
  historyOpen: boolean
  shortcutsOpen: boolean
  shiftReportOpen: boolean
  settingsOpen: boolean
  paletteOpen: boolean
  helpOpen: boolean
  /** Mirrors what's actually applied to <html> (see `domain/appearance.ts`) so
   * the Settings radiogroups have something reactive to render as checked —
   * applying the attribute itself is a DOM side effect, not React state. */
  theme: appearance.Theme
  typeface: appearance.Typeface
  toast: { id: number; text: string; kind: 'info' | 'warn' } | null
}

export interface AppState {
  /** null until the first snapshot arrives. In mock mode the store connects
   * at boot, regardless of auth (STATES.md: lane timers/ladder/paging run on
   * the server whether or not an operator is signed in). Over HTTP it can't:
   * the snapshot needs a session (API-CONTRACT.md §2e), so it connects after
   * the desk pick and drops back to null on sign-out. Either way `auth` is
   * what gates the UI. */
  server: Snapshot | null
  ui: UiState
  auth: AuthSession
  connection: ConnectionState
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
  record: null,
  historyOpen: false,
  shortcutsOpen: false,
  shiftReportOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  helpOpen: false,
  theme: appearance.getStoredTheme(),
  typeface: appearance.getStoredTypeface(),
  toast: null,
}

const initialAuth: AuthSession = {
  status: 'signed-out', operator: null, desk: null, signedInAt: null, email: null,
}

const initialConnection: ConnectionState = { status: 'online', since: null }

type Listener = () => void

export interface NocStoreOptions {
  /** HTTP mode: load the snapshot and open the event socket only once a
   * session exists (after `selectDesk`), and drop them on sign-out. Default
   * false: the caller connects at boot, as the mock always has. */
  connectAfterSignIn?: boolean
  /** Apply incoming events once per animation frame instead of one at a
   * time (point 5, docs/PERFORMANCE.md). Over the WebSocket every event is
   * its own message, so without this every event was its own React commit:
   * 200 events/s meant ~200 full renders a second. Default false (tests,
   * which read state synchronously); main.tsx turns it on. */
  coalesceEvents?: boolean
}

/** Longest an event waits when frames aren't running (a hidden tab pauses
 * requestAnimationFrame): the store still keeps up, just in bigger steps. */
const FLUSH_MAX_WAIT_MS = 100

/** Wait between snapshot attempts while resyncing after a reconnect. */
const RESYNC_RETRY_MS = 2000

/**
 * Minimal external store (works with useSyncExternalStore). Depends on NocClient only,
 * so replacing the mock with HTTP + WebSocket changes nothing in here.
 */
export class NocStore {
  private state: AppState = {
    server: null, ui: initialUi, auth: initialAuth, connection: initialConnection,
  }
  private connectionTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<Listener>()
  private toastSeq = 0
  private unsubscribe: (() => void) | null = null
  private unsubscribeConnection: (() => void) | null = null
  /** Non-null while a snapshot load is in flight: events that arrive
   * meanwhile are held here and applied on top of the snapshot. */
  private buffered: ServerEvent[] | null = null
  private syncing: Promise<void> | null = null
  /** Resolves connect() once the first socket open has synced. */
  private firstOpen: (() => void) | null = null
  /** coalesceEvents: received, not yet applied. */
  private pending: ServerEvent[] = []
  private flushFrame: number | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly client: NocClient,
    private readonly opts: NocStoreOptions = {},
  ) {}

  /* ---------- useSyncExternalStore contract ---------- */

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getState = (): AppState => this.state

  /* ---------- lifecycle ---------- */

  async connect(): Promise<void> {
    if (this.unsubscribe) return
    // Subscribe first so nothing emitted between snapshot and subscribe is
    // lost: sync() holds events in `buffered` until the snapshot is in.
    this.buffered = []
    // With a real connection, the snapshot has to be taken *after* the
    // socket is open, or events emitted between the two are lost: the
    // snapshot predates them and the socket wasn't listening yet. So wait
    // for the first 'online' and sync then, the same order every reconnect
    // uses. The mock is connected synchronously, so it syncs straight away.
    const opened = this.client.onConnectionChange
      ? new Promise<void>((resolve) => (this.firstOpen = resolve))
      : null
    this.unsubscribeConnection = this.client.onConnectionChange?.((s) => void this.onConnection(s)) ?? null
    this.unsubscribe = this.client.subscribe((e) => {
      if (this.buffered) {
        this.buffered.push(e)
        return
      }
      if (this.opts.coalesceEvents) {
        this.pending.push(e)
        this.scheduleFlush()
        return
      }
      if (!this.state.server) return
      this.setServer(applyEvent(this.state.server, e))
      this.notifyLadderAdvance(e)
    })
    await (opened ?? this.sync())
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    const run = () => this.flushPending()
    if (typeof requestAnimationFrame === 'function') this.flushFrame = requestAnimationFrame(run)
    this.flushTimer = setTimeout(run, FLUSH_MAX_WAIT_MS)
  }

  /** Applies every pending event in one pass and notifies React once. */
  private flushPending(): void {
    if (this.flushFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.flushFrame)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushFrame = null
    this.flushTimer = null
    if (!this.pending.length || !this.state.server) return
    const events = this.pending
    this.pending = []
    let s = this.state.server
    for (const e of events) s = applyEvent(s, e)
    this.setServer(s)
    for (const e of events) this.notifyLadderAdvance(e)
  }

  /** Server state as of every event received so far. Commands read through
   * this, never `this.state.server` directly: with coalescing on, the last
   * frame's events may not be applied yet, and a command must not decide
   * from state up to a frame old. */
  private current(): Snapshot | null {
    if (this.pending.length) this.flushPending()
    return this.state.server
  }

  /** Loads a fresh snapshot and applies whatever events arrived meanwhile.
   * Used on connect and after every reconnect (API-CONTRACT.md §2c: resync
   * by re-snapshot, not by replaying missed events). Retries until it
   * succeeds or the store disconnects; concurrent calls share one load. */
  private sync(): Promise<void> {
    this.buffered ??= []
    // Events from before this (re)sync are superseded by the snapshot it loads.
    this.pending = []
    this.syncing ??= (async () => {
      while (this.unsubscribe) {
        try {
          let snap = await this.client.getSnapshot()
          for (const e of this.buffered ?? []) snap = applyEvent(snap, e)
          this.buffered = null
          this.setServer(snap)
          return
        } catch {
          await new Promise((r) => setTimeout(r, RESYNC_RETRY_MS))
        }
      }
    })().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  /** The real connection (HttpNocClient's event socket). Offline shows the
   * banner and refuses site actions, as the simulated outage always did.
   * Back online, the banner stays up until the resync has finished, so the
   * operator never acts on state from before the drop. */
  private async onConnection(s: 'online' | 'offline'): Promise<void> {
    if (s === 'offline') {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer)
        this.connectionTimer = null
      }
      if (this.state.connection.status !== 'offline') {
        this.setConnection({ status: 'offline', since: new Date().toISOString() })
      }
      return
    }
    const first = this.firstOpen
    if (!first && this.state.connection.status !== 'offline') return
    this.firstOpen = null
    await this.sync()
    first?.()
    if (this.state.connection.status === 'offline') this.setConnection({ status: 'online', since: null })
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
    this.unsubscribeConnection?.()
    this.unsubscribeConnection = null
    this.buffered = null
    this.firstOpen?.() // don't leave a pending connect() hanging
    this.firstOpen = null
    this.pending = []
    this.flushPending() // clears the scheduled frame/timer; nothing left to apply
  }

  /* ---------- commands (UI intent -> client) ---------- */

  /** Queue row click. An already-open incident (Working tab) just needs
   * focus — same safe path (mic-confirm included) as the lane card/
   * escalation bar/palette use, not a second openIncident that would
   * silently no-op. A not-yet-open alert (New/Held) still goes through
   * openIncident, which only steals focus if nothing else currently has it. */
  async openIncident(alertId: string): Promise<void> {
    const already = this.current()?.incidents.find((i) => i.alertId === alertId)
    if (already) {
      // Jumping to a lane that's already open is a local focus change, not
      // a site command — not blocked offline, unlike actually taking one.
      await this.requestFocus(already.id)
      return
    }
    if (this.refuseIfOffline()) return
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
      this.patchUi({ cameraViewReturnTo: this.current()?.focusIncidentId ?? null })
      await this.client.setFocus(null)
    }
    this.patchUi({ viewingCameraId: cameraId })
  }

  /** Esc / "Back to lane" — restores the lane that was focused before, if it's still open. */
  async closeCameraView(): Promise<void> {
    const returnTo = this.state.ui.cameraViewReturnTo
    this.patchUi({ viewingCameraId: null, cameraViewReturnTo: null })
    if (returnTo && this.current()?.incidents.some((i) => i.id === returnTo)) {
      await this.client.setFocus(returnTo)
    }
  }

  /** Raise incident (I) from camera view — no AI alert behind it, the operator picks the priority. */
  async raiseIncident(cameraId: string, priority: QueuePriority): Promise<void> {
    if (this.refuseIfOffline()) return
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
    const s = this.current()
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
    const s = this.current()
    if (!s) return
    if (this.refuseIfOffline()) return
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
  /** Dispatch, siren and strobe all reach the site directly — refused
   * offline like take/talk-down/raise, never queued (connection-lost help
   * article). Halt/resume aren't in that list: left alone. */
  async confirmDispatch(id: string): Promise<void> {
    if (this.refuseIfOffline()) return
    await this.client.confirmDispatch(id)
  }
  async setSiren(id: string, on: boolean): Promise<void> {
    if (this.refuseIfOffline()) return
    await this.client.setSiren(id, on)
  }
  async setStrobe(id: string, on: boolean): Promise<void> {
    if (this.refuseIfOffline()) return
    await this.client.setStrobe(id, on)
  }
  acknowledgePage = (desk: number) => this.client.acknowledgePage(desk)
  acknowledgeEscalation = (incidentId: string) => this.client.acknowledgeEscalation(incidentId)

  async addNote(text: string): Promise<boolean> {
    const id = this.current()?.focusIncidentId
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
    this.patchUi({ closingIncidentId: null, record: r.value })
    return true
  }
  closeRecord(): void {
    this.patchUi({ record: null })
  }
  /** History (Part 9): re-opens an already-sealed Record by id. */
  async openRecord(incidentId: string): Promise<void> {
    const r = await this.client.getRecord(incidentId)
    if (!r.ok) {
      this.toast(r.error.message, 'warn')
      return
    }
    this.patchUi({ record: r.value })
  }
  setHistoryOpen(open: boolean): void {
    this.patchUi({ historyOpen: open })
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
  setHelpOpen(open: boolean): void {
    this.patchUi({ helpOpen: open })
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

  /* ---------- auth (Part 8) ---------- */

  /** Pure passthroughs — the sign-in/lock screens need the specific error
   * code and detail (attempts left, retry countdown) to render the right
   * copy, so these return the Result as-is rather than collapsing it into
   * a generic toast the way most other commands do. */
  requestCode(email: string): Promise<Result<{ resendAfterSec: number }>> {
    return this.client.requestCode(email)
  }
  verifyCode(email: string, code: string): Promise<Result<{ operator: AuthOperator }>> {
    return this.client.verifyCode(email, code)
  }

  /** Completes sign-in (SignInScreen, after verifyCode): picks a desk and
   * activates the session. Takes the operator/email from the caller rather
   * than remembering them store-side — verifyCode's own result (plus the
   * email it was called with) already has both. */
  async selectDesk(deskId: number, operator: AuthOperator, email: string): Promise<Result<null>> {
    const r = await this.client.selectDesk(deskId)
    if (r.ok) {
      this.setAuth({ status: 'active', operator, desk: deskId, signedInAt: new Date().toISOString(), email })
      if (this.opts.connectAfterSignIn) await this.connect()
    }
    return r
  }

  /** Completes an unlock (LockScreen, after its own verifyCode) — no separate
   * unlock endpoint exists (DECISIONS.md): re-running requestCode/verifyCode
   * is the whole mechanism, this just flips the local status back. */
  unlock(): void {
    if (this.state.auth.status !== 'locked') return
    this.setAuth({ ...this.state.auth, status: 'active' })
  }

  lock(): void {
    if (this.state.auth.status !== 'active') return
    void this.client.lock()
    this.setAuth({ ...this.state.auth, status: 'locked' })
  }

  async signOut(): Promise<Result<null>> {
    const r = await this.client.signOut()
    if (r.ok) {
      this.setAuth(initialAuth)
      if (this.opts.connectAfterSignIn) {
        this.disconnect()
        this.state = { ...this.state, server: null, connection: initialConnection }
        this.emit()
      }
    }
    return r
  }

  /* ---------- connection (Part 8, connection-lost) ---------- */

  /** "Simulate: connection lost" from the command palette — the help
   * article's own prototype trigger, 8 simulated seconds. Nothing in
   * MockNocClient actually goes offline; see ConnectionState's doc comment. */
  simulateConnectionLost(): void {
    if (this.state.connection.status === 'offline') return
    this.setConnection({ status: 'offline', since: new Date().toISOString() })
    this.connectionTimer = setTimeout(() => this.goOnline(), 8000)
  }

  /** "Retry now" on the banner. A simulated outage just ends early; a real
   * one asks the client to reconnect now instead of waiting out its backoff,
   * and the banner clears once that reconnect has resynced (onConnection). */
  retryNow(): void {
    if (this.state.connection.status !== 'offline') return
    if (!this.connectionTimer && this.client.reconnectNow) this.client.reconnectNow()
    else this.goOnline()
  }

  private goOnline(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = null
    }
    this.setConnection({ status: 'online', since: null })
  }

  /** Gate for the 6 site-affecting actions the connection-lost article
   * names (take, talk-down, siren, strobe, raise, dispatch): "Offline · not
   * sent: nothing is queued to fire later" — never queued, always toasted. */
  private refuseIfOffline(): boolean {
    if (this.state.connection.status !== 'offline') return false
    this.toast('Offline · not sent', 'warn')
    return true
  }

  /* ---------- internals ---------- */

  private setAuth(auth: AuthSession): void {
    this.state = { ...this.state, auth }
    this.emit()
  }
  private setConnection(connection: ConnectionState): void {
    this.state = { ...this.state, connection }
    this.emit()
  }
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
