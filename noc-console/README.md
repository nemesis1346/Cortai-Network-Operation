# NOC Console (phase 1, frontend on mock data)

React + Vite + TypeScript. Spec of record: `../docs/cortai-soc-operator-console (1).html`.
UX/UI audit: `../docs/CORTAI-Sentry-UX-UI-Audit-EВ.docx`. Brief: `../docs/NOC-Task-Brief-Marco.md`.

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
src/hooks/                useNow (1s timer, isolated), useHotkeys (ignores typing), useMediaQuery
src/components/           All screens built: TopBar, CriticalBand, lanes + queue, camera ribbon,
                           estate tree + watch list, lane activity, voice strip, closeout/report
                           modals, mic-confirm dialog, toasts, shortcuts legend
src/styles/tokens.css     All design tokens; audit values, mockup originals in comments
```

## Design notes
- State arrives as `ServerEvent`s. A WebSocket client replaces `MockNocClient` without touching components.
- The server sends anchors (`openedAt`, `focusedSince`, `ladder.startedAt`); the client derives running timers
  (`src/domain/timing.ts`), so there is no per-second global re-render.
- Alert `working` follows an open incident; it is never seeded (fixes the audit's C5 counter mismatch).
- Queue rank is lexicographic: inside property line, then watch index, then age.
- The voice strip has no ladder mini-status panel. The brief lists one, but the approved audit (A9) found it
  duplicated each lane's own ladder row under different wording and told us to remove it — the audit wins
  where it conflicts with the brief, per the standing decision on this project.
- No native `window.confirm()`/`alert()` anywhere (mic hand-off, discard-memo, wall-lock refusal all use
  in-app dialogs) — a native dialog blocks the whole page, including other lanes' timers (audit C7).


