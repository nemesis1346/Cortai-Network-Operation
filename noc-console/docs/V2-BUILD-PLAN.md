# v2 build plan

Breaking the rest of the approved v2 deviations into parts, same granularity as phase 1 (scaffold →
lanes+queue → camera ribbon+activity → estate tree+watch list → modals → voice strip): each part is one
region, cohesive enough to build, typecheck, test and verify live on its own before moving to the next.

Order follows dependency, not the deviations table's order: the Lane Workspace is the architectural
pivot everything else hangs off — the right rail's content, what "focused" even means, and where the
Comms Dock sits all follow from it. Building the peripheral regions first would mean redoing them once
the center exists.

| # | Part | Replaces | Depends on | Status |
|---|---|---|---|---|
| 1 | **Lane Workspace** — one focused lane fills the centre; watch (video, evidence, timeline) \| decide (risk factors, ladder, deterrents, note, close) as two columns inside it. | `Lanes.tsx`/`Lane.tsx`'s 1/2/2+mini grid | — | **Done**, 6 Oct |
| 2 | **Lane Cards** — peripheral lanes as right-rail cards: live sub-stream, unattended meter (notice 30s / warning 45s / alarm 60s), escalation bar, A/B/C to focus. | `PeripheralLanes.tsx`'s minimal stub rows | Part 1 | **Done**, 7 Oct |
| 3 | **Estate tree + queue adjustments** — status-dot totals (Live/Motion/Fault/Offline) replacing the camera ribbon; queue's `All`/`P1–P2` filter. | `CameraRibbon.tsx` (ribbon strip + fault list) | — (independent of 1–2) | Not started |
| 4 | **Camera wall** — status tabs, stays open while incidents are open; a tile opens a camera view or the lane that owns it. | the wall-overlay half of `CameraRibbon.tsx` | Part 3 | Not started |
| 5 | **Comms Dock** — mic binding, waveform, "Move mic here (M)" inside the focused lane; transcript becomes a lane tab. | `VoiceStrip.tsx` | Part 1 | Not started |
| 6 | **Named ladder + closeout fit** — Talk-down/Siren/Keyholder/Dispatch stage names; Dispatch requires explicit confirm, shown dimmed for P3/P4; closeout adapted to the new layout. | stage names in `domain/constants.ts`; `CloseoutModal.tsx` positioning | Part 1 | Not started — Halt/Resume already landed in Part 1, ahead of schedule |
| 7 | **New-in-v2 screens** — History (sealed records), Shift report, camera view without an incident, Settings, Help (F1), sign-in/lock/connection-lost, command palette (⌘K). Purely additive, nothing existing to replace. | — | Parts 1–6 for cross-links (e.g. History reachable from a closed lane) | Not started |

## Part 1 notes

**Judgment calls made, not a direct spec read** — worth checking with Oleg if they come up:
- Evidence and timeline are stacked in the watch column rather than tabbed. Tabs' third sibling,
  Transcript, belongs to the Comms Dock (Part 5), which doesn't exist yet — may convert to tabs once it
  does, or may not if stacked reads fine in practice.
- Two-way talk stays a click-toggle, not real push-to-talk. True hold-to-talk is entangled with the
  Comms Dock's mic placement, deliberately out of this part's scope.
- Risk-factor weights (high/medium/low) for the existing six seed alerts are my own read of each
  alert's chips, not sourced from Figma — reasonable, but worth Oleg's eyes if the weighting ever
  matters for something downstream.

**Added beyond the Lane Workspace itself, because `ResponseLadder`'s own spec required it**:
`resumeLadder` (R key) — the mockup/v1 could halt a ladder but never resume it. v2's `onResume` prop
and H/R keyboard pairing made the gap concrete, so it's fixed now rather than carried forward.

**Real bug found and fixed during verification, not a test artifact**: the browser's native trailing
`click` event (which fires after every pointerdown+pointerup on the same element, including a 600ms
hold gesture) was reaching the siren/strobe buttons' "disarm on click" handler and immediately undoing
the arm it had just completed — every successful hold silently self-cancelled. Confirmed live:
`aria-pressed` read `true` at 700ms while still held, then `false` again right after release. Fixed with
a `justArmed()` guard in `useHoldToArm` that the disarm handler checks first. See the hook's doc comment.

Parts 1–2 and 6 carry the two items that didn't get an explicit "yes" (Lane Workspace, wall-stays-open)
— see `DECISIONS.md`'s 5 Oct update. Building them now; flagging anything that reads as a real judgment
call rather than a faithful read of the Figma/STATES.md spec, for Marco to check with Oleg if it comes up.

Each part gets its own commit(s), typecheck + tests, and a live browser verification pass before moving
on — same discipline as phase 1, not a batch rewrite.

## Part 2 notes

**New domain concept, not just new UI**: a lane's unattended *streak* (time since it last had focus,
resets on every visit, drives self-escalation) is distinct from its pre-existing lifetime unattended
*total* (`unattendedSec`, cumulative, feeds shift stats/closeout). Conflating them would have either
kept escalating a lane forever after one early visit, or escalated off a stale lifetime number instead
of the current gap. Added `Incident.unattendedSince` (anchor, cleared on focus) and
`domain/timing.ts#unattendedStreakSec` alongside the existing `unattendedSec`, kept both.

**Judgment calls made, not a direct spec read**:
- `acknowledgeEscalation` (K) silences *that lane's* bar for the rest of the current streak — it does
  not suppress the 60s auto-page, which still fires as its own side effect of the unattended state
  (confirmed against STATES.md §1: ack is `escalated → escalated`, "timer not reset", and the page is
  listed under the `peripheral → escalated` transition itself, not the ack transition). Verified live:
  acknowledging at 45s, then letting the clock run past 60s, still produces the desk page.
- EscalationBar's only primary action on an incident-specific bar is Acknowledge (K). v2's COMPONENTS.md
  doesn't list a "hand to desk 3" alternate action on the bar itself, and full operator-to-operator
  hand-off isn't modeled in the domain yet (no `handoff-requested` state) — out of scope here, not
  forgotten.
- Lane letter/accent coloring on `LaneCard` reuses the existing A=cyan/B=violet/C=neutral convention from
  `LaneWorkspace` and the old peripheral-row stub, rather than introducing new per-priority card coloring
  — priority already has its own P1–P4 badge, stacking a second color system on the same card read as
  more confusing, not less.

**Testing approach**: the 30/45/60s thresholds are exercised with Vitest fake timers
(`vi.useFakeTimers()` + `vi.advanceTimersByTime`) against the mock client's real 1s tick — not mocked
out — so the store tests exercise the same `tick()` → `maybePage()` path production does. Live browser
verification used Playwright's `page.clock` API (installed *before* navigation, so the page's own
intervals are born fake-clock-backed) to fast-forward through all three thresholds without a real
60-second wait; confirmed the card's color/meter and the EscalationBar's text/tier at each one, the
auto-page firing at 60s, acknowledge falling back to the generic desk-page bar, and a re-focused lane's
streak resetting to 0 with its ack cleared. No real bugs found this pass — the state machine behaved
exactly as `STATES.md` specifies at every threshold on the first run.
