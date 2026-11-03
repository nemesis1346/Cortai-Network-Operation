import type { LadderStageDef } from '../api/types'

export const MAX_LANES = 3
/** Audit A14 (approved): 40. The mockup used 12. */
export const MEMO_MIN_LENGTH = 40
/** Descriptors below this confidence are left out of the voice callout. */
export const SLOT_MIN_CONFIDENCE = 0.85
export const LANE_LETTERS = ['A', 'B', 'C'] as const

/**
 * Unattended-lane self-escalation (v2 STATES.md §2). A peripheral lane's card
 * meter turns amber at NOTICE, the EscalationBar appears at WARNING, and the
 * supervisor is auto-paged at ALARM.
 */
export const UNATTENDED_NOTICE_SEC = 30
export const UNATTENDED_WARNING_SEC = 45
export const UNATTENDED_ALARM_SEC = 60

/**
 * v2 STATES.md §3. Durations line up with the unattended self-escalation
 * clock on purpose (UNATTENDED_NOTICE/WARNING/ALARM_SEC above) — the ladder
 * doesn't start talking until the lane itself starts reading as unattended.
 * Dispatch has no atSec: "never automatic", confirmed by the operator only
 * (`NocClient.confirmDispatch`), available any time, not gated on Keyholder.
 */
export const LADDER_STAGES: LadderStageDef[] = [
  { index: 0, name: 'Talk-down', atSec: UNATTENDED_NOTICE_SEC },
  { index: 1, name: 'Siren', atSec: UNATTENDED_WARNING_SEC },
  { index: 2, name: 'Keyholder', atSec: UNATTENDED_ALARM_SEC },
  { index: 3, name: 'Dispatch' },
]

/**
 * Part 8 · auth (Yassine, 3 Nov): email-code sign-in, replacing the v2
 * prototype's password step. Lionston rules, verbatim.
 */
export const OTP_CODE_LENGTH = 6
export const OTP_VALID_MIN = 10
export const OTP_RESEND_SEC = 30
export const OTP_MAX_PER_EMAIL_PER_HOUR = 5
export const OTP_MAX_WRONG_ATTEMPTS = 3
export const EMAIL_LOCK_MIN = 15
export const SESSION_MAX_HOURS = 24
/** Idle lock timeout. Yassine's number (15) supersedes the v1.2 lock-screen
 * help article's 10 — that article predates the OTP rework; see DECISIONS.md. */
export const IDLE_LOCK_MIN = 15
