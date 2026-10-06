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
                           useHoldToArm (v2's 600ms hold-to-arm gesture, pointer + keyboard)
src/components/           LaneWorkspace (v2 Part 1: the focused lane, full width, watch | decide
                           columns) + PeripheralLanes (other open lanes, right rail — a stub until
                           Part 2's full LaneCard), Queue, camera ribbon, estate tree + watch list,
                           voice strip, closeout/report modals, mic-confirm dialog, toasts, shortcuts
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
- The voice strip has no ladder mini-status panel. The brief lists one, but the approved audit (A9) found it
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


