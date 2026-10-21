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
| 3 | **Estate tree + queue adjustments** — status-dot totals (Live/Motion/Fault/Offline) replacing the camera ribbon; queue's `All`/`P1–P2` filter. | `CameraRibbon.tsx` (ribbon strip + fault list) | — (independent of 1–2) | **Done**, 9 Oct |
| 4 | **Camera wall** — status tabs, stays open while incidents are open; a tile opens a camera view or the lane that owns it. | the wall-overlay half of `CameraRibbon.tsx` | Part 3 | **Done**, 12 Oct |
| 5 | **Comms Dock** — mic binding, waveform, "Move mic here (M)" inside the focused lane; transcript becomes a lane tab. | `VoiceStrip.tsx` | Part 1 | **Done**, 13 Oct |
| 6 | **Named ladder + closeout fit** — Talk-down/Siren/Keyholder/Dispatch stage names; Dispatch requires explicit confirm, shown dimmed for P3/P4; closeout adapted to the new layout. | stage names in `domain/constants.ts`; `CloseoutModal.tsx` positioning | Part 1 | **Done**, 14 Oct — Halt/Resume landed in Part 1, ahead of schedule |
| 7 | **New-in-v2 screens** — History (sealed records), Shift report, camera view without an incident, Settings, Help (F1), sign-in/lock/connection-lost, command palette (⌘K). Purely additive, nothing existing to replace. | — | Parts 1–6 for cross-links (e.g. History reachable from a closed lane) | 5 of 7 sub-parts shipped, 20 Oct — only History and sign-in/lock left, both blocked (see below) |

### Part 7 sub-parts

| Screen | Status |
|---|---|
| Camera view without an incident (CameraWorkspace) | **Done**, 15 Oct |
| Shift report | **Done**, 16 Oct |
| Settings (theme/typeface) | **Done**, 16 Oct |
| Command palette (⌘K) | **Done**, 16 Oct |
| Help (F1) | **Done**, 20 Oct |
| History (sealed records) | **Blocked** — entangled with the still-open Report/Record merge, `DECISIONS.md` #5 |
| Sign-in / lock / connection-lost | **Blocked** — needs the Lionston OTP flow, `DECISIONS.md` the auth blocker |

## Part 1 notes

**Judgment calls made, not a direct spec read** — worth checking with Oleg if they come up:
- ~~Evidence and timeline are stacked in the watch column rather than tabbed.~~ **Resolved in Part 5**:
  Timeline and Transcript are now tabs; Evidence stays always-visible (compact, and the build plan only
  ever called out Transcript becoming a tab).
- ~~Two-way talk stays a click-toggle, not real push-to-talk.~~ **Resolved in Part 5**: real hold-to-talk,
  `useHoldToTalk`, once the Comms Dock existed to give the mic-routing concept somewhere to live.
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

## Part 3 notes

**A real conflict in the v2 package itself, resolved in Yassine's favor**: the deviations table proposes
replacing the queue's New/Working/Held tabs with a Figma-driven filter; `OPEN-QUESTIONS.md` #4 shows the
Figma and prototype-code disagreeing with each other on what that filter even is (Waiting/Held/Done
today vs. All/P1–P2). Yassine's decision #4 (`DECISIONS.md`) already settled the tabs question directly
— "keep it, add the Hold action," marked **Done** against what phase 1 already built — without
referencing either Figma variant. Read that as closing the tabs question entirely, not as one option
among several still open. So the `All`/`P1–P2` control here is additive: a `SegmentedControl` that
narrows whichever tab is active, sitting below the tabs rather than replacing them. If Oleg's Figma
shows something incompatible with this reading, worth a quick check — but it isn't a re-open of the
Held-tab decision itself.

**Flagged gap, not a judgment call**: v2's `EstateStat` wants four buckets — Live, Motion, Fault,
Offline. `CameraStatus` only has three (`'live' | 'motion' | 'down'`), with nothing distinguishing a
faulted-but-reachable camera from a genuinely offline one. Rather than fabricate a split with no real
backend signal behind it, `EstateStats` renders three tiles (Live/Motion/Fault) and leaves Offline out
entirely. Noted here and worth asking Oleg/backend whether that distinction is meant to come from the
same `down` state with extra metadata, or is a real 4th state — this is a data-model question, not a UI
one, so not mine to invent an answer for.

*Resolved in Part 4*: `STATES.md` §7 turned out to already define both precisely ("fault = degraded
stream, flagged to maintenance; offline = no signal, speaker/deterrents may be unavailable") — missed
when first scanning the docs for Part 3. `CameraStatus` is now a real 4-value type; see Part 4 notes.

**Not dropped, relocated**: the old ribbon's per-camera fault list (which camera, how long down) read as
a second home for information the Estate tree already owns once its pip strip is gone — audit A9's "one
place per job" argument applies here too, even though A9 itself was about the pips specifically. Moved
the down-duration onto each camera's own row in the tree (visible once its site is expanded) rather than
deleting it outright; the ribbon's top-level list would have been the only place `DownDuration` existed,
and dropping it silently would have been a real feature loss the deviations table never asked for.

**Verified live**: EstateStat totals matched the seed data (10 live / 2 motion / 1 fault) and the shape
convention (circle/diamond/square, audit B10) carried over from the old pips. The down camera's row
showed a running duration. The old `.pip`/`.faults` markup is gone from the DOM. The priority filter
correctly narrowed New-tab rows to P1/P2 only and restored on switching back to All. Wall toggle still
present and functional (Part 4's job to replace). No real bugs found.

## Part 4 notes

**Shipping a Figma-pending item**: the wall staying open while incidents are open is one of the two
items Yassine wanted to see on Figma before deciding (`DECISIONS.md`, 5 Oct). That call isn't happening
in a structured way, and the 5 Oct note already says to build ahead of it — this is where that risk
actually lands. `toggleWall()` no longer refuses while lanes are open; the overlay only ever covered the
centre column (audit A11), so lane cards, the EscalationBar and their timers are untouched underneath
it. Worth a confirmation from Marco before this reaches real use, per the standing note on both
Figma-pending items.

**`CameraStatus` grew a real 4th value**: `CameraWall`'s own filter tabs (`'all'|'live'|'motion'|'fault'
|'offline'`, v2 COMPONENTS.md) can't be built faithfully on 3 states — "Order: motion, fault, offline,
then live" only makes sense if those are 4 distinct, mutually exclusive buckets. `STATES.md` §7 (missed
during Part 3's scan, worth noting for next time) defines both precisely, so this isn't invented: fault =
degraded stream, still live, flagged to maintenance; offline = no signal, speaker/deterrents may be
unavailable. `types.ts#CameraStatus` is now `'live' | 'motion' | 'fault' | 'offline'`; seed data split
the one existing down camera into one of each so both paths are actually exercised, not just typed.

**Byproduct: `cameraSummary` became an honest exclusive partition.** It used to return `live: total -
down`, which *included* motion cameras (carried over from the phase-1 ribbon's summary line). The Wall's
tab counts need a strict partition — a camera can't be in two tabs — so `live` now means exactly
`status === 'live'`, matching `motion`/`fault`/`offline`. This changes what the EstateStat row and
TopBar's health pill show (e.g. "7 Live" where it used to overlap into "10 Live"); TopBar's own `cams.live
+ cams.motion` reasoning wasn't affected since it already computed "working" as open-incidents-plus-
motion separately, and its health pill now does `total - fault - offline` inline rather than reading a
pre-blended `live` field. The old "N camera fault" pill is now "N camera issue(s)" since it covers two
real failure modes, not one.

**Camera view without an incident is deliberately not built**: v2 deviations#13 says a wall tile for a
camera with no owning lane should open "a camera view" — that screen is Part 7 (new-in-v2, purely
additive), not built yet. Building a one-off partial version of it here to serve just this click would be
scope creep beyond what Part 4 replaces. `CameraTile` says so via a toast instead of a dead click; a
tile for a camera an open lane *does* own focuses that lane and closes the wall (the one interaction this
part can actually complete end to end).

**Real bug found and fixed during verification, not a test artifact**: the Camera Wall overlay rendered
as a squashed strip at the bottom of the screen instead of covering the centre column — `.wall-overlay`'s
`position: absolute; inset: 0` was resolving against `.cams-region` (also `position: relative`, a
leftover from the old pip-tooltip system removed in Part 3), not `.center`, because `.wall-overlay` is a
DOM child of `.cams-region`, which sits nearer in the ancestor chain. Fixed by dropping the now-vestigial
`position: relative` off `.cams-region`. Caught via a screenshot during live verification — the "Camera
wall" header and tabs rendered, but no grid, and a scripted tile click failed because the tile was being
occluded by footer/centre elements outside the (mis-sized) overlay. Re-verified after the fix: full-size
grid, correct tile order, filter tabs, lane-focus click, unowned-camera toast, and the wall staying open
with an incident active, all confirmed with a clean screenshot.

## Part 5 notes

**Resolves two Part 1 deferrals, not just builds something new**: Timeline/Transcript tabs and real
hold-to-talk were both explicitly left for "once the Comms Dock exists" — see the struck-through items
above. Worth noting for future parts: deferrals like this are easy to lose track of once the part that
was blocking them ships; grepping the build plan for the blocking part's name before starting it is
cheap insurance.

**Hold-to-talk's start/stop had to be designed, not just read off STATES.md**: the spec says "hold Space
/ hold button, release" with no arming delay (unlike siren/strobe's 600ms — confirmed by its *absence*
from Talk-down's row in the Deterrents table, Section 4). But the existing `toggleMic` command is a
genuine toggle (bind if free, release if owned-by-me), which doesn't map cleanly onto "press always
means talk, never means hang up" — a real radio's PTT release doesn't drop the channel. Resolution,
with zero backend changes: the Talk button's press handler calls `toggleMic` only when this lane doesn't
already own the mic (claims it, same as before); release is purely local UI state, never touches the
server. The M key and CommsDock's "Move mic here" button still call `toggleMic` unconditionally, so M
keeps its existing, already-documented toggle behavior (open/close) as the one remaining explicit-release
affordance. `useHoldToTalk` (new hook) has no arm delay or progress fill, unlike `useHoldToArm` — a
genuinely different gesture, not a renamed copy.

**StatusBar wasn't in the one-line Part 5 description, but is still this part's job**: the deviations
table's full text for this row says the old voice strip splits into *two* replacements — Comms Dock
(per-lane, rich) and "Status bar shows mic and running sirens" (global, minimal). Built both; leaving
the global one out would mean a siren running on a lane you've stepped away from becomes invisible the
moment you're not looking at that specific lane, which the audit's whole throughline (EscalationBar,
LaneCard meters) argues against. No other build-plan part owns "Status bar."

**Judgment call — Notes is not a third tab**: v2 COMPONENTS.md's generic Tabs example says "Timeline ·
Transcript · Notes," but that phrase turns out to describe `RecordModal`'s tabs (a Part 7 sealed-record
view), not necessarily this lane's live tabs — confirmed by `UI-SPEC.md`'s `N` shortcut ("Jump to note
field"), which only makes sense if the note field stays a persistent, always-reachable input rather than
hidden behind a tab click. Kept the note field exactly where it was.

**Real bug found and fixed, not a test artifact**: `LaneWorkspace` was rendered with no `key` prop in
`Lanes.tsx`, so React never remounted it on a lane switch — local state (note draft, and now also which
watch-tab is open) silently carried over to whatever lane you switched to next. Existed since Part 1;
only became obvious now that there's a second piece of local state (`watchTab`) to leak alongside the
note draft. Fixed with `key={focused.id}`. Verified live: typed a note into Lane A, switched to Lane B
cold (no mic bound, so no confirm dialog in the way) — note field and watch-tab both reset correctly:
empty field, Timeline selected. A first verification attempt looked like the fix had failed, since the
note text was still showing after pressing `B` — turned out the mic *was* bound to Lane A at that point,
so `requestFocus` correctly opened the mic-confirm dialog instead of switching focus at all (existing,
correct, unrelated behavior); re-tested without binding the mic first and the fix held.

**Verified live**: old `.voice-strip`/`.vs-*` DOM confirmed gone; `StatusBar` renders "Mic: Unbound ·
Sirens: None running" with no incident open; pressing Talk shows the `.talking` pulse immediately,
`aria-pressed` flips true, CommsDock updates to "Mic open to this lane" with the live transcript line,
StatusBar's Mic field updates to the lane letter; releasing clears the pulse but keeps the binding
(`aria-pressed` stays true); re-pressing while already bound adds no duplicate transcript line; the
MicConfirmDialog flow (pre-existing, untouched) still correctly gates a focus switch while the mic is
bound elsewhere.

## Part 6 notes

**Not just a rename — the ladder's own meaning changed**: v1/phase 1's 4 stages were all spoken AI
announcements, escalating in tone, ending in an automatic siren. v2's STATES.md §3 replaces this with 1
spoken stage (Talk-down) followed by 3 escalating *actions* (Siren auto-arms, Keyholder call queues,
Dispatch waits for the operator) — a different shape, not new labels on the old one. `buildCallout`
(dynamic, built from the alert's own descriptors) is now Talk-down's sole content; the old static
intro/final-warning/closing lines are retired, not ported forward.

**Timings changed too, deliberately**: STATES.md's 30s/45s/60s for Talk-down/Siren/Keyholder are
identical to `UNATTENDED_NOTICE/WARNING/ALARM_SEC` — confirmed this isn't a coincidence (both model the
same "how long has this lane gone unaddressed" question) and wired `LADDER_STAGES` to reference those
constants directly rather than duplicating the numbers. Stage 1 no longer fires at t=0 the way v1's did;
the ladder now starts in a new `'armed'` status (counting toward Talk-down, not yet speaking) — this
status already existed in `types.ts` with a comment ("waiting for stage 0") but was never actually set
anywhere, so this wires up dead-but-anticipated code rather than inventing new state.

**Dispatch has no `atSec` — designed, not a bug**: STATES.md's duration column is literally "—" for
Dispatch, distinct from Keyholder's "60s". Read as: Dispatch isn't a 4th timed rung on the automatic
ladder at all, it's a standalone operator-confirmed action, available any time (not gated on Keyholder
having fired — a P1 might warrant jumping straight to it) and *including when the ladder is suppressed*
(a judgment call I got wrong on the first pass — see the real-bug note below). `LadderStageDef.atSec`
is now optional; `tick()`'s firing loop and `secondsToNextStage` both skip stages without one.

**Judgment call — dimmed means dimmed, not disabled**: "Shown dimmed for P3/P4" reads as a visual
treatment (muted styling, same `.dim`/opacity convention as the P4 queue rows), not a hard block —
consistent with the project's standing pattern of operator judgment over automated gates for the most
severe actions. The button stays clickable for P3/P4, just visually de-emphasized.

**Judgment call — no confirm-dispatch hotkey**: unlike H/R, STATES.md's Deterrents table lists no key
for Dispatch, and it's the one truly irreversible action in the whole app (can't un-call the police) —
click-through with an in-app confirm dialog only (matching the project's no-`window.confirm()` discipline,
audit C7), consistent with how "Close incident" also has no forced global hotkey.

**Closeout "adapted to the new layout" scoped narrowly, not as a 3-step rebuild**: v2's CloseoutModal
spec lists `step: 'memo' | 'next-steps' | 'done'`, but a full 3-step rebuild would entangle with the
still-**Blocked** Report/Record merge (`DECISIONS.md` #5 — needs the History feature, which doesn't
exist). Scoped this part to what's actually unblocked: the recap's "Voice stages played: N of 4" line
(meaningless once stages have real names and Dispatch has no fixed total) became "Ladder reached:
{stage name}".

**Real bug found and fixed, not a test artifact — this time caught before shipping, not after**: my
first pass gated `confirmDispatch` behind `status !== 'suppressed'`, reasoning that a suppressed ladder
(allow-listed plate, camera fault) shouldn't escalate to Dispatch. Live-testing against a suppressed
seed alert (`a3`, "camera fault, not a presence event") showed the Confirm Dispatch button never
rendering — correct per my own logic, but wrong: `setSiren`/`setStrobe` have no ladder-status guard at
all, so an operator can already override suppression manually for those; Dispatch should follow the
same discipline, not invent a stricter rule STATES.md never stated. Fixed by dropping the suppressed
check everywhere (component, client, and a new store test exercising it against `a3` directly) — only
`'complete'` blocks it now.

**Verified live**: full ladder progression at t=0/30/45/60s (Armed → Talk-down → Siren auto-arms,
without halting the ladder → Keyholder, no further countdown since Dispatch has no atSec); Confirm
Dispatch's in-app dialog, Cancel leaving the ladder untouched, Confirm producing "Stage 4 confirmed ·
Dispatch" and flipping to Complete; the dispatch button dimmed for a P3/P4 lane and available (not
hidden) for a suppressed one; a peripheral lane reaching Keyholder producing a toast naming the lane;
the closeout recap showing the real stage name reached. StatusBar's Sirens field picked up the
ladder-armed siren automatically, confirming it isn't wired only to the manual setSiren path.

## Part 7 notes (camera view without an incident)

**Part 7 is too big for one pass — split into sub-parts rather than attempted whole.** The build plan's
one-liner bundles seven genuinely different screens. Two are explicitly blocked already (History needs
the still-open Report/Record merge; sign-in/lock needs the Lionston OTP flow, neither of which changed
since `DECISIONS.md`). Of what's left, Camera View closes a loose end I left myself in Part 4 (the
"camera view isn't built yet" toast on an unowned wall tile) and is the most self-contained, so it went
first. Shift report, Settings and Command palette are reasonable next picks, in roughly that order of
value; Help is lower priority since it's mostly content authoring, not logic.

**Scoped narrower than the full CameraWorkspace spec, flagged not dropped**: v2's spec has speech,
deterrents and notes write to a "site log" while viewing a camera, then migrate into the new lane on
Raise. Phase 1 has no pre-incident logging surface at all — `CommsDock`, `useHoldToTalk` and
`setSiren`/`setStrobe` all take an `incidentId` throughout the codebase — building a parallel no-incident
path for them would be a real architectural fork, not a small addition, for a flow the real UX probably
doesn't need anyway: an operator who sees something worth talking to on an idle camera raises the
incident first, then has full deterrent/talk capability from inside the new lane immediately, which
already works end to end. This version of `CameraWorkspace` is: view the camera, browse other cameras at
the same site, raise an incident at a chosen priority. Documented here as the explicit scope cut it is,
not discovered as a gap later.

**Raising without an AI alert needed a real design decision, not a shortcut**: every other alert in the
system has `derivePriority`-computed priority (Yassine, 1 Oct: "never set by hand"). An operator raising
straight from a camera has no AI severity to compute from — there's no alert yet, hence no computed
value to defer to. Rather than add a second priority representation (a hand-set field some code paths
read and others don't), the new alert's `severity`/`insidePropertyLine` are chosen so `derivePriority`
lands on exactly the tier the operator picked — P4 needs severity 3 + outside-the-line specifically,
since severity itself tops out at 3. Every other component (Queue, LaneWorkspace, the closeout recap)
keeps working completely unchanged; they have no idea this alert didn't come from the AI.

**Breaking attention reused `setFocus(null)` wholesale, not a new mechanism**: STATES.md §2 says camera
view "breaks attention for all lanes." The attention model (Part 2) already keys entirely off
`focusIncidentId` — a lane only reads as attended when it IS the focus. Opening camera view therefore
just calls the existing `setFocus(null)`, the same call a focus switch already makes; every lane
(including the one that was focused) starts counting its unattended streak immediately, no new state or
special-casing needed in the escalation selectors at all.

**Verified live**: opening a wall tile for an unowned camera correctly opens CameraWorkspace and closes
the wall; the site-camera strip switches which camera is shown without touching focus a second time;
raising at each of the four priorities produced an alert whose `derivePriority` matched exactly; the new
lane integrated cleanly with every earlier part (ladder started Armed with the usual 30/45/60s timing,
Confirm Dispatch available and undimmed at P1, CommsDock and StatusBar both correct) with no adjustments
needed anywhere; Esc correctly restored the lane that was focused before camera view opened; the Raise
button correctly disabled with a hint once three lanes were already open. No real bugs found.

## Part 7 notes (Shift report)

**Needed one genuinely new piece of server state, not just a derived view**: `ShiftStats` already tracked
running totals (closedAttendedSec, visits, etc.), but `closeIncident` discarded the incident entirely
after producing its one-off `IncidentReport` — there was no list of what actually got closed this shift
to build a table or an hour histogram from. Added `Snapshot.closedThisShift: ClosedIncidentSummary[]`,
appended to on every close, carried in `incident.closed`'s own event payload so the client-side reducer
(which has no access to the server's internals, only what's on the event) can replay it correctly from a
buffered-event catch-up the same way every other piece of state already does.

**`ClosedIncidentSummary` stores `severity`/`insidePropertyLine`, not a precomputed priority** — same
discipline as everywhere else in the app: `derivePriority` is the one place priority gets computed, so
the summary row keeps its inputs, not an output that could drift out of sync with the formula.

**Real bug caught by my own component, not live testing**: wrote the table's "Closed" column using
`c.closedAt.slice(11, 16)` (matches every other timestamp display in the app — UTC digits read straight
off the ISO string) but wrote `closedByHour`'s bucketing with `Date#getHours()`, which reads the
machine's *local* timezone. The two would have silently disagreed by however many hours off UTC the
deployment machine sits at — caught by re-reading my own code before running it live, not by a failing
test (the first test draft used `Date` objects too, so it wouldn't have caught this either). Fixed by
bucketing off the same string slice the table uses.

**Verified live**: KPIs and the empty-state message correct with nothing closed yet; closing one incident
updates the KPI row, adds the correct table row, and lights up the matching hour on the histogram; Copy
summary writes to the clipboard and confirms with a toast; Esc closes the modal. No real bugs found in
the live pass (the timezone bug above was caught beforehand, while writing the code).

## Part 7 notes (Settings — theme + typeface)

**Light theme isn't invented — it's Oleg's own, read through this project's existing token names.**
`docs-v2/tokens/cortai-noc-v2-tokens.css` turned out to contain his real, complete design system,
including a full light theme built on its own numbered primitive scale (428 contrast pairs, his own
`check_contrast.py`) — not something I expected to find sitting in the reference package. That file's
architecture (semantic tokens like `--color-status-critical-fg` built from primitives like `--red-700`)
is more granular than this project's flat token set (`--red`, `--red-bg`, etc.), and adopting it wholesale
would be a separate, much bigger migration than "add a Settings modal." Instead, each of this project's
existing ~20 color tokens maps onto its nearest equivalent in his file for the light variant — documented
inline in `tokens.css` so the correspondence is traceable, not a reinterpretation. Three typefaces (IBM
Plex default, Inter + JetBrains Mono, Atkinson Hyperlegible) switch via `[data-typeface]`, matching
`UI-SPEC.md` §7 exactly, including the two `localStorage` key names (`sentry.theme.v2`, `sentry.face`) —
kept as-is rather than renamed, so a workstation that ever runs the real prototype alongside this build
shares one stored preference instead of each silently ignoring the other's key.

**Real bug, caught by the test suite before it ever reached a browser**: `store.ts`'s `initialUi` reads
`appearance.getStoredTheme()`/`getStoredTypeface()` at module-eval time to seed the UI state — and
`appearance.ts` called `localStorage`/`document` directly, unguarded. The whole domain/store layer runs
its unit tests in a plain Node environment on purpose (`vite.config.ts`: fast, no jsdom overhead), so
just *importing* `store.ts` under Node started throwing — breaking every single test in `store.test.ts`,
not just new ones. Fixed by feature-detecting `localStorage`/`document` in `appearance.ts` and falling
back to sensible Node-safe defaults (dark/plex, no-op DOM writes); added `appearance.test.ts` as
regression coverage for exactly this. A reminder that adding a browser-coupled module anywhere the
store layer touches at module scope needs the same DOM-optional discipline the rest of that layer
already has — not obvious until the test suite actually caught it.

**Judgment call — only Settings' own two radiogroups got real roving-focus arrow-key support.**
`UI-SPEC.md` §6 says "Theme and typeface are radiogroups with arrow keys," and three *other* existing
radiogroups in the app (Queue's P1–P2 filter, CameraWall's status filter, CameraWorkspace's raise-
priority selector) are click-only today, pre-dating this part. Built a small reusable
`useRovingRadiogroup` hook and used it for Settings specifically, since that's what this part asked for;
retrofitting the other three is a real, worthwhile, but separate accessibility cleanup, not something to
fold into "add Settings" unannounced.

**Verified live**: default theme has no `data-theme` attribute (dark, matching the CSS default); clicking
Light sets the attribute and repaints the whole app correctly (confirmed `body` background/text color
match the new tokens exactly); arrow-key roving focus moves both the selection and real DOM focus
together across the typeface group; the computed `font-family` reflects each selection's full fallback
chain; both settings persist under their exact spec'd `localStorage` keys and are restored correctly
before first paint on reload (no flash observed). Screenshot-checked the light theme across every region
of the app (estate tree, queue, watch list, status bar) — legible throughout, no washed-out elements.

## Part 7 notes (Command palette)

**Judgment call — no `scope: LaneId | 'all'` tab.** The spec's prop table lists one, but with a 3-lane
cap, the "Lanes" group already lets you jump to any lane directly from the full list, and "Focused lane"
actions are already inherently scoped to the one lane that's focused — there's only ever one. A dedicated
scope tab felt like Figma affordance carried over from a design meant to scale further than this app's
own 3-lane ceiling ever will; added complexity without matching value here. Flagged as a deliberate
simplification, not a missed requirement, in case it matters once the real interaction model lands.

**"Destructive commands require Enter twice" needed a real decision about where authority lives.**
Confirm Dispatch already has its own on-screen confirm dialog (Part 6), reachable by clicking the lane's
own button. The palette is a *second*, independent entry point that can't reach into that dialog's local
component state — so it needed its own safety gate, which is exactly what the spec's double-Enter
instruction is for. Implemented as: first Enter arms the command (shows "Press Enter again to confirm",
the ladder stays untouched), second Enter actually calls `confirmDispatch` directly, bypassing
LaneWorkspace's dialog entirely rather than trying to trigger it remotely. Every other command in the set
either reversible or itself just opens an existing confirm surface (Close incident opens the closeout
flow, it doesn't close anything by itself) — Confirm Dispatch is genuinely the only one that fires a
real, irreversible effect straight from a single keystroke, which is why it's the only one marked
`destructive` in `buildCommands`.

**Ctrl/⌘+K intentionally works from inside a text field** (the note field, closeout memo, anywhere) —
every other global hotkey in the app is deliberately suppressed while typing (audit C1), but real
command palettes (Slack, Linear, GitHub) conventionally work everywhere, and that's the expectation this
follows. It still won't open on top of a genuinely blocking flow (closeout, report, mic confirm) — the
browser's own Ctrl/⌘+K (address-bar search) is suppressed either way so the keystroke never leaks out to
the OS/browser even when the palette itself doesn't open.

**No dedicated toolbar button.** Shift report/Settings/Keyboard shortcuts all got a TopBar button; the
palette didn't, on purpose — it's meant to be keyboard-first by design, and `ShortcutsLegend` already
documents the key. Adding a button mostly for pointer-discoverability would cut against what makes a
command palette fast in the first place; flagged as the deliberate choice it is, not an oversight.

**Verified live**: Ctrl+K opens the palette with focus landing in its input; groups are conditional and
correct (no Lanes/Focused-lane group with nothing open; both appear once a lane exists); typing filters
correctly; Enter runs a non-destructive command (Shift report) and closes the palette; Confirm Dispatch's
double-Enter gate holds the ladder untouched after the first Enter and only fires on the second; Ctrl+K
opens correctly from inside a focused text input without losing its draft text; the underlying lane's
state (note draft, ladder) was unaffected by opening/closing the palette around it. No real bugs found.

## Part 7 notes (Help)

**A real content deliverable was sitting in the reference package, not just a spec.** `docs-v2/prototype/
help/help.js` turned out to be Oleg's actual, complete Help content — 41 articles across 7 sections, 27
real screenshots (`.webp`, his own dark-theme captures), 4 inline-SVG diagrams, a documented Markdown
subset, and a "loading contract" section in `docs-v2/docs/HELP.md` addressed explicitly to the React
build. This changed the shape of the work: not "write 41 articles," but "build the renderer and
navigation for content that already exists." Converted `help.js` → `public/help/help.json` (plain data,
no transform of the words themselves) and copied the 27 screenshots into `public/help/img/` — both
shipped as real static assets, loaded lazily on first open per the loading contract, not bundled.

**Content fidelity: shipped verbatim, not edited to match this build's exact state — flagged instead.**
Auditing and rewriting 41 real articles to match every judgment call this build has made along the way
would be a large, error-prone content-authoring task of its own, and not mine to do unilaterally — these
are Oleg's words. Six articles describe screens that don't exist in this build yet: `sign-in`,
`lock-screen`, `connection-lost`, `sign-in-problems` (all blocked on the Lionston OTP flow) and
`incident-records` (blocked on the Report/Record merge, `DECISIONS.md` #5) — `helpContext()` simply never
routes to them, but they're still reachable by search or by clicking through the tree. Eight articles
reference a **T** "Take next" key/button (`take-alarm`, `first-alarm`, `close-incident`, `lane-lifecycle`,
`queue-priority`, `keyboard-shortcuts`, `lane-limit`, `sign-in`) that this build never bound — the actual
interaction here is clicking a specific queue row directly, which `take-alarm`'s own second half
("Take a specific alarm") already describes correctly. Worth a quick confirmation with Oleg on whether T
is still intended, same standing note as the rest of this project's Figma-pending items.

**A second, different CSS-variable naming convention showed up, not just the two from Part 6's tokens
work.** The 4 diagrams' inline SVGs reference `var(--c-text-primary)`, `var(--c-status-ok-solid)`, etc. —
a *third* naming scheme, distinct from both this project's own flat tokens and Oleg's semantic
`--color-*` tokens from Settings. Rather than rewrite 4 real SVGs (the same "not mine to edit" reasoning
as the article text), added a scoped `--c-*` alias block on `.help-diagram` mapping each of the 18 names
actually used to this project's existing tokens — the SVGs render in this app's theme unmodified.
Verified live: a diagram's text computed to this project's actual `--text-2` color, not a missing-variable
fallback.

**The Markdown-subset renderer is hand-rolled, not a library** — the full grammar (headings, lists,
numbered steps, tables, 5 callout types, figures, diagrams, key combos, internal/external links, and 5
inline UI tokens) is documented in `help.js`'s own header comment and is small and fixed enough that a
~250-line parser (block splitter + one combined inline regex) covers it completely, with React elements
built directly rather than `dangerouslySetInnerHTML` over trusted-but-still-rendered article text (the
one exception is the 4 diagrams' own inline SVG, which really is `dangerouslySetInnerHTML` — justified in
the code because that markup is static, developer-authored content copied verbatim, not live user input).

**Judgment calls, scoped down from the full tree/search spec:**
- Tree keyboard nav supports Up/Down (flat roving focus across visible rows) and Right/Left
  (expand/collapse a section) but not Home/End — a full WAI-ARIA tree widget's remaining interactions,
  lower value than getting the primary navigation path solid. Click always works regardless.
- One "Help" command in the palette's Navigation group, not all 41 articles as individual commands (the
  real spec's "every article is a command") — 41 more entries would have swamped the palette's existing,
  already-small Navigation group for a convenience search already covers once Help itself is open.
- `helpContext()` only implements the rows STATES.md §10 lists for screens this build actually has; the
  "sites sheet" row (a mobile-only drawer state) isn't tracked in global `UiState` and was left out rather
  than approximated.

**Verified live**: F1 with no lanes open opened `console-overview`; with a lane open, `lane-workspace`;
with a lane escalated (≥45s), `escalation` — confirming STATES.md §10's priority order held in practice,
not just in the one new test file covering `helpContext()` in isolation. Tree click-navigation, search
("/"-to-focus, all-terms-must-match, Enter opens the top hit), a diagram rendering in-theme, a table and
a numbered-steps list, Related links, Previous/Next in tree order, and the meta line all confirmed with
real content. The figure lightbox's hotspot markers matched its legend 1:1 (12 and 12 on the article
checked); Esc closed the lightbox first and the whole modal second, exactly as specified. No real bugs
found in the live pass.

## Bug fix, 21 Oct: S/L never actually worked

**Found by Marco while scripting a demo for Yassine, not by live verification here.** The Siren and
Strobe buttons have shown `<kbd>S</kbd>`/`<kbd>L</kbd>` hints since Part 1, but the literal keys were
never wired anywhere — `useHoldToArm`'s keyboard handling only ever listened for Enter/Space while the
button itself had DOM focus (reachable only by Tab-ing to it, which nobody would discover), and neither
key was in `useHotkeys.ts`'s global listener or `ShortcutsLegend`. Pressing **S** from anywhere else in
the console, which is what the button's own hint promises, silently did nothing. Missed in every prior
live-verification pass because testing used pointer-hold on the button directly, never the literal key.

Fixed by making S/L real global hotkeys on the focused lane (`useHotkeys.ts`, matching H/R/M/W/K), hold
600ms to arm, single press to disarm (STATES.md §4's actual stop column — not a hold to turn off, which
the Enter/Space-on-button path already got right but the new global path needed to match). Rather than a
second, disconnected timer with no visual feedback, `useHoldToArm` grew a small two-slot registry (siren/
strobe — at most one `LaneWorkspace` is mounted at a time, so no need to key it by incident) that a
global keydown/keyup can drive directly, so the button's own hold-fill animation plays correctly
regardless of which input method triggered it. Both now documented in `ShortcutsLegend`, where they were
never listed before either.

Verified live: a tap released before 600ms doesn't arm; the `--hold` CSS variable reads mid-progress
during an active global-key hold (confirming the same hook instance drives both paths, not a disconnected
timer); a full hold arms and updates `StatusBar`'s Sirens field; a single press while armed disarms
correctly for both Siren and Strobe; typing a literal "s" inside the note field does nothing to the siren
and the typed text is unaffected (the existing `isTypingTarget` guard already covered this correctly once
S/L were added through the same dispatch path as H/R/M).
