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
src/domain/               Pure rules: queue priority, memo check, callout, timing, ladder labels
src/store/                reducer (ServerEvent -> state), NocStore (commands + UI state), selectors, React context
src/hooks/                useNow (1s timer, isolated), useHotkeys (ignores typing), useMediaQuery
src/components/           TopBar, CriticalBand, ViewportGate done; Regions.tsx = placeholders to replace
src/styles/tokens.css     All design tokens; audit values, mockup originals in comments
```

## Design notes
- State arrives as `ServerEvent`s. A WebSocket client replaces `MockNocClient` without touching components.
- The server sends anchors (`openedAt`, `focusedSince`, `ladder.startedAt`); the client derives running timers
  (`src/domain/timing.ts`), so there is no per-second global re-render.
- Alert `working` follows an open incident; it is never seeded (fixes the audit's C5 counter mismatch).
- Queue rank is lexicographic: inside property line, then watch index, then age.

## Decisions (audit approved by Yassine)
- The audit is the spec. Where it conflicts with the brief or mockup, the audit wins.
- Memo minimum is 40 characters (`MEMO_MIN_LENGTH`), counter shown from the start.
- Breakpoints: drawers below 1180px, "designed for 1280px+" gate below 1024px.
- Tokens in `tokens.css` follow the audit.

## Still open (discuss with Oleg)
- Is lane "C" a real hotkey? The mockup shows the badge but handles only A/B.
