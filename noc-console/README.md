# NOC Console (frontend on mock data)

React + Vite + TypeScript. Phase 1 (faithful to the original mockup + audit) shipped and was approved
by Yassine 1 Oct. Now mid-build on Oleg's v2 redesign — see `docs/DECISIONS.md` (what's signed off),
`docs/V2-BUILD-PLAN.md` (the 7-part build order, status per part) and `docs/API-CONTRACT.md` (the
engineering contract). Spec of record for phase 1: `../docs/cortai-soc-operator-console (1).html`.
UX/UI audit: `../docs/CORTAI-Sentry-UX-UI-Audit-EВ.docx`. v2 source: `../docs-v2/` (gitignored, reference
only).

## Run
```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the business rules
npm run typecheck
```

## Structure
```
src/api/types.ts          Proposed backend contract (entities, ServerEvent, commands)
src/api/client.ts         NocClient interface, the only door between UI and data
src/api/mock/             MockNocClient (simulates ladder, evidence, paging) + seed data
src/domain/               Pure rules: queue priority, memo check, callout, timing, ledger grouping
src/store/                reducer (ServerEvent -> state), NocStore (commands + UI state), selectors, React context
src/hooks/                useNow (1s timer, isolated), useHotkeys (ignores typing), useMediaQuery,
                           useHoldToArm (v2's 600ms hold-to-arm gesture, siren/strobe), useHoldToTalk
                           (v2's no-delay press/release gesture, two-way talk), useRovingRadiogroup
                           (v2 Part 7: arrow-key roving focus, Settings' theme/typeface groups)
src/components/           LaneWorkspace (v2 Part 1: the focused lane, full width, watch | decide
                           columns; v2 Part 5: Timeline/Transcript tabs, CommsDock; v2 Part 6: named
                           ladder, Confirm Dispatch) + PeripheralLanes/LaneCard (v2 Part 2: other open
                           lanes, right rail — live sub-stream, priority badge, self-escalating
                           unattended meter), EscalationBar (desk-level alarm, supersedes CriticalBand),
                           Queue (v2 Part 3: All/P1-P2 priority filter alongside the tabs), estate tree
                           (v2 Part 3: EstateStat totals, sole owner of per-camera status), CameraWall
                           (v2 Part 4: status-tab filter, stays open while incidents are open, supersedes
                           CameraRibbon), CommsDock (v2 Part 5: mic routing + waveform + last line,
                           inside the focused lane), StatusBar (v2 Part 5: global mic/sirens summary,
                           supersedes VoiceStrip), CameraWorkspace (v2 Part 7: camera view with no
                           incident, raises a lane), ShiftReportModal (v2 Part 7: KPIs, incidents-by-
                           hour, closed-this-shift table), SettingsModal (v2 Part 7: theme + typeface,
                           `domain/appearance.ts`), CommandPalette (v2 Part 7: Ctrl/⌘+K, search lanes/
                           queue/actions), watch list, closeout/report modals,
                           mic-confirm dialog, toasts, shortcuts
src/styles/tokens.css     All design tokens; audit values, mockup originals in comments
```

## Design notes
- State arrives as `ServerEvent`s. A WebSocket client replaces `MockNocClient` without touching components.
- The server sends anchors (`openedAt`, `focusedSince`, `ladder.startedAt`); the client derives running timers
  (`src/domain/timing.ts`), so there is no per-second global re-render.
- Alert `working` follows an open incident; it is never seeded (fixes the audit's C5 counter mismatch).
- Queue rank is lexicographic: computed priority P1–P4 (severity × inside-the-line, never hand-set —
  `domain/rules.ts#derivePriority`), then watch index, then age. Changed 2 Oct per Yassine's decision;
  see `docs/DECISIONS.md`.
- No ladder mini-status panel in the footer. The brief lists one, but the approved audit (A9) found it
  duplicated each lane's own ladder row under different wording and told us to remove it — the audit wins
  where it conflicts with the brief, per the standing decision on this project.
- No native `window.confirm()`/`alert()` anywhere (mic hand-off, discard-memo, wall-lock refusal all use
  in-app dialogs) — a native dialog blocks the whole page, including other lanes' timers (audit C7).
- Siren/strobe arm on a 600ms hold (`useHoldToArm`), not a click — v2 UI-SPEC.md §5. The browser's
  trailing `click` after any press-release, including the hold gesture itself, will silently undo the
  arm unless the disarm handler checks `justArmed()` first; found live, not in review — see the hook's
  doc comment and `docs/V2-BUILD-PLAN.md`'s Part 1 notes.
- The ladder can now resume after a halt (R key), not just halt — picks up from where it paused, not
  from 0. The mockup/v1 never had this; v2's `onResume` prop made the gap concrete.
- Peripheral lanes self-escalate on their own unattended *streak* (time since last focus, resets on
  every visit) — distinct from the pre-existing lifetime unattended total that feeds shift stats.
  Notice at 30s, warning (EscalationBar) at 45s, auto-page at 60s (v2 STATES.md §2). Acknowledge (K)
  silences one lane's bar without resetting its streak or suppressing the auto-page — both are modeled
  as independent side effects of the unattended state, not of the ack. See `docs/V2-BUILD-PLAN.md`'s
  Part 2 notes.
- The camera ribbon's pip strip and fault list duplicated the estate tree (audit A9) once the tree had
  its own status dots — removed. The tree is now the sole source of per-camera status, including down
  duration on each camera's own row. Its header shows a one-row Live/Motion/Fault/Offline totals strip.
- The queue's New/Working/Held tabs stay as Yassine decided 1 Oct (`docs/DECISIONS.md` #4) — the v2
  package's own Figma and prototype code disagree with each other about replacing them, so that decision
  reads as closing the question outright. A separate All/P1–P2 segmented filter narrows whichever tab is
  active instead of replacing the tabs.
- `CameraStatus` is `'live' | 'motion' | 'fault' | 'offline'` — fault (degraded stream, still live) and
  offline (no signal) are genuinely different per v2 STATES.md §7, not a UI distinction invented on top
  of one `down` bucket. `cameraSummary` is an exclusive partition of all four; nothing overlaps.
- The camera wall stays open while incidents are open (v2 deviations#13) — one of the two items Yassine
  wanted to see on Figma first before this got built anyway (`docs/DECISIONS.md`, 5 Oct). The overlay
  only ever covered the centre column (audit A11), so lane cards and the EscalationBar keep running
  underneath it. A wall tile for a camera an open lane owns focuses that lane; a tile for a camera with
  no lane opens CameraWorkspace (v2 Part 7). See `docs/V2-BUILD-PLAN.md`'s Part 4 notes, including a
  real CSS positioning bug found and fixed during live verification.
- The global voice strip footer is gone, split into two per v2 deviations#5: `CommsDock` (mic routing,
  waveform, last transcript line, "Move mic here") lives inside the focused lane now; `StatusBar`
  (just Mic + Sirens) stays as a minimal global footer so a siren on a lane you're not looking at is
  never invisible. Transcript is a Timeline/Transcript tab pair in the watch column, scoped per incident
  — not a third "Notes" tab, since the note field needs to stay a persistent, directly-reachable input
  (`N` jumps to it per UI-SPEC.md) rather than something hidden behind a tab.
- Two-way talk is real hold-to-talk (`useHoldToTalk`, no arm delay, unlike siren/strobe's 600ms) instead
  of a click-toggle — press claims the mic if this lane doesn't already have it, release just stops the
  local "talking" indicator without dropping the binding (a real PTT radio doesn't change channel on
  release). `M` still toggles bind/release outright, unchanged.
- `LaneWorkspace` now gets `key={focused.id}` in `Lanes.tsx` — without it, local state (note draft,
  which watch-tab is open) silently survived a lane switch instead of resetting. A real bug since Part
  1, caught once there was a second piece of local state to make it obvious. See `V2-BUILD-PLAN.md`'s
  Part 5 notes.
- The response ladder is Talk-down → Siren → Keyholder → Dispatch (v2 STATES.md §3), not v1's 4 spoken
  announcements ending in an automatic siren — a different shape, not a rename. Talk-down/Siren/
  Keyholder fire automatically at 30/45/60s (the same constants the unattended self-escalation clock
  uses — not a coincidence); Siren auto-arms without halting the ladder (that's `setSiren`'s own
  operator-override side effect, not this). Dispatch has no `atSec` at all — "never automatic" — and is
  confirmed by the operator only, any time, including on a suppressed ladder (suppression stops the
  automated stages, not the operator's own judgment; `setSiren`/`setStrobe` already worked this way).
  Dimmed, not disabled, for P3/P4. The ladder starts `'armed'` (counting toward Talk-down, not yet
  speaking) — a status that already existed in `types.ts` with a "waiting for stage 0" comment but was
  never actually set until now. See `docs/V2-BUILD-PLAN.md`'s Part 6 notes for a judgment call that was
  wrong on the first pass (gating Dispatch on suppression) and fixed before it shipped.
- Part 7 (new-in-v2 screens) is split into sub-parts — it's seven different screens, two of them already
  blocked (History on the Report/Record merge, sign-in/lock on the Lionston OTP flow). First up:
  CameraWorkspace, a camera with no incident. Scoped narrower than the full spec: no pre-incident
  "site log" for speech/deterrents/notes before raising — `CommsDock`/`useHoldToTalk`/`setSiren`/
  `setStrobe` all take an `incidentId` throughout, and the real flow raises first, then uses full
  deterrent capability from inside the new lane, which already works. Raising without an AI alert picks
  `severity`/`insidePropertyLine` so `derivePriority` lands on exactly the operator's chosen tier,
  rather than adding a second, hand-set priority representation other code would need to know about.
  Opening camera view reuses `setFocus(null)` wholesale for "breaks attention for all lanes" (STATES.md
  §2) — the attention model already keyed entirely off `focusIncidentId`, so no new escalation logic was
  needed. See `docs/V2-BUILD-PLAN.md`'s Part 7 notes.
- Shift report needed one genuinely new piece of server state: `Snapshot.closedThisShift`, a list of
  `ClosedIncidentSummary` appended to on every close. `ShiftStats` only ever tracked running totals;
  `closeIncident` fully discarded the incident after its one-off report, so there was nothing to build a
  table or an hour histogram from. Carried in `incident.closed`'s own event payload, same as everything
  else the client-side reducer replays. Stores `severity`/`insidePropertyLine`, not a precomputed
  priority, for the same reason nothing else in the app does. Caught and fixed a timezone bug in my own
  code before it ever ran live: the table read hours straight off the ISO string (matches every other
  timestamp in the app); the histogram's bucketing first used `Date#getHours()`, which reads the
  machine's local timezone — the two would have silently disagreed. See `docs/V2-BUILD-PLAN.md`'s Part 7
  notes.
- Dark/Light theme and three typefaces (IBM Plex default, Inter + JetBrains Mono, Atkinson Hyperlegible)
  switch via `data-theme`/`data-typeface` on `<html>` (`domain/appearance.ts`), persisted per workstation
  under the v2 prototype's own `localStorage` keys (`sentry.theme.v2`, `sentry.face`). The light theme's
  colors aren't invented — `docs-v2/tokens/cortai-noc-v2-tokens.css` turned out to hold Oleg's real,
  complete token system including a full light theme; each of this project's existing flat color tokens
  maps onto its nearest equivalent there (documented inline in `tokens.css`), rather than adopting his
  whole, more granular architecture wholesale. `appearance.ts` guards every `localStorage`/`document`
  access — `store.ts` reads it at module-eval time to seed UI state, and the whole domain/store layer's
  unit tests deliberately run in a plain Node environment with neither available; this broke the entire
  test suite before being caught and fixed, not just new tests. See `docs/V2-BUILD-PLAN.md`'s Part 7
  notes.
- Command palette (Ctrl/⌘+K) works even from inside a text field — every *other* global hotkey is
  suppressed while typing (audit C1), but this one follows how real command palettes conventionally
  behave instead. "Confirm dispatch" is the only command marked destructive (double-Enter to confirm,
  v2 COMPONENTS.md#CommandPalette): it's the one command that fires a real, irreversible effect from a
  single keystroke rather than just opening an existing confirm surface, so it got its own gate that
  calls `confirmDispatch` directly rather than trying to trigger LaneWorkspace's own dialog remotely.
  No `scope: LaneId | 'all'` tab from the full spec — the "Lanes" group already covers jumping to any
  lane directly at this app's 3-lane ceiling. See `docs/V2-BUILD-PLAN.md`'s Part 7 notes.


