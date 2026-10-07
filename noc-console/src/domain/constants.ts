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

export const LADDER_STAGES: LadderStageDef[] = [
  { index: 0, name: 'Announcement', atSec: 0 },
  { index: 1, name: 'Descriptive callout', atSec: 12 },
  { index: 2, name: 'Final warning', atSec: 30 },
  { index: 3, name: 'Siren, then hold', atSec: 45 },
]
