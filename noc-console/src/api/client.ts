import type { QueuePriority } from '../domain/rules'
import type {
  AuthOperator,
  CloseIncidentInput,
  Incident,
  IncidentReport,
  Result,
  ServerEvent,
  Snapshot,
} from './types'

/**
 * The only door between UI and data. Phase 1 implements it with MockNocClient;
 * integration swaps in an HTTP + WebSocket client. Components and the store
 * depend on this interface alone.
 */
export interface NocClient {
  getSnapshot(): Promise<Snapshot>
  /** Returns an unsubscribe function. */
  subscribe(handler: (event: ServerEvent) => void): () => void

  openIncident(alertId: string): Promise<Result<Incident>>
  /** v2 CameraWorkspace: raises a lane straight from a camera with no AI alert
   * behind it — the operator picks the priority by hand (there's no severity
   * to derive it from), unlike every AI-raised alert. */
  raiseIncident(cameraId: string, priority: QueuePriority): Promise<Result<Incident>>
  /** Parks a 'new' alert without opening a lane. Yassine, 1 Oct: keep the Held tab, add this action. */
  holdAlert(alertId: string): Promise<Result<null>>
  closeIncident(incidentId: string, input: CloseIncidentInput): Promise<Result<IncidentReport>>
  setFocus(incidentId: string | null): Promise<Result<null>>
  /** incidentId null releases the mic. Without force, a bound mic returns MIC_BUSY. */
  bindMic(incidentId: string | null, opts?: { force?: boolean }): Promise<Result<null>>
  haltLadder(incidentId: string): Promise<Result<null>>
  /** Resumes a halted ladder from where it paused, not from 0 (v2 UI-SPEC.md §6: H/R). */
  resumeLadder(incidentId: string): Promise<Result<null>>
  /** Stage 4, never automatic — the operator's own call, any time (v2 STATES.md §3). */
  confirmDispatch(incidentId: string): Promise<Result<null>>
  setSiren(incidentId: string, on: boolean): Promise<Result<null>>
  setStrobe(incidentId: string, on: boolean): Promise<Result<null>>
  addNote(incidentId: string, text: string): Promise<Result<null>>
  acknowledgePage(desk: number): Promise<Result<null>>
  /** K: quiets the EscalationBar for this lane's current unattended streak without resetting its timer. */
  acknowledgeEscalation(incidentId: string): Promise<Result<null>>
  /** Manual "Page second desk" from the lane-limit refusal. Yassine, 1 Oct: add as a third button. */
  requestDeskPage(reason: string): Promise<Result<null>>

  /* ---------- Auth (Part 8, Yassine 3 Nov) ---------- */

  /** Any email is accepted (no account enumeration). Rate-limited to 5/email/hour,
   * resend cooldown 30s (RESEND_TOO_SOON / RATE_LIMITED). Also the lock screen's
   * "fresh email code" — there's no separate unlock endpoint, it's this same pair. */
  requestCode(email: string): Promise<Result<{ resendAfterSec: number }>>
  /** 3 wrong codes burns it and locks the email for 15 min (EMAIL_LOCKED). */
  verifyCode(email: string, code: string): Promise<Result<{ operator: AuthOperator }>>
  selectDesk(deskId: number): Promise<Result<null>>
  lock(): Promise<Result<null>>
  signOut(): Promise<Result<null>>
}
