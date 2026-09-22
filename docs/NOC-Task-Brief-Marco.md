# NOC Console — Frontend Task Brief

For: Marco · UX/UI review with: Oleg
From: Yassine · 2026-09-15
Reference file: `cortai-soc-operator-console (1).html` (design mockup, the spec of record)

## Context

The NOC (Network Operations Center) is the operator console for security alerts coming from
the camera AI on our sites. One operator watches many sites: cameras only stream when there
is an alert, alerts are taken from a queue into incident "lanes" (max 3), and an automatic
voice ladder does the first response until the operator takes over. The attached HTML mockup
is a full working demo of the concept with hardcoded data. Open it in a browser and play
with it before reading further.

## Your task — phase 1, frontend only

Implement the console as a real frontend app, faithful to the mockup, against a mock data
layer. Backend integration comes after, so everything must sit behind a clean API client.

**Process: review the UX/UI with Oleg FIRST.** Go through the mockup together, list any
changes you two propose (as a short doc or annotated screenshots), and send it to me for
sign-off before implementing. Do not silently diverge from the mockup.

## Stack

React + Vite + TypeScript (team standard, same direction as the PM portal). Keep the
mockup's CSS as the visual reference: dark theme, Archivo + JetBrains Mono, same colour
tokens. Single-page app, no router needed for phase 1.

## Screens / regions to implement (all in the mockup)

1. Top bar: brand, shift clock, operator identity, open incident count, health pills.
2. Left rail: estate tree (sites > cameras with status dots) and the 7-day watch list
   (score, trend, signals, 24h hour strip, cluster window, note).
3. Center: incident lanes (1 / 2 / 2+mini layouts), each lane = video slot, bounding box
   overlay, chips, ladder stage pips + countdown, evidence thumbnail strip, action buttons
   (Two-way talk, Siren, Strobe, Close incident).
4. Camera ribbon: pips per camera with hover tooltip, fault list, expandable wall
   (locked while incidents are open, shows motion cameras only).
5. Right rail: queue tabs New / Working / Held, lane activity (attended / unattended /
   visits + ledger), note input bound to the focused lane, tie-break rule, shift stats.
6. Voice strip (footer): speaker state + waveform, mic binding, ladders mini-status,
   transcript.
7. Closeout modal: required memo (blocks close), next-step checklist, recap.
8. Incident report modal.
9. Toasts.

## Behaviours to keep exactly

- Max 3 open lanes; opening a 4th is refused with the "page the second desk" toast.
- Focus model: click or keys A / B select a lane; attended vs unattended time accrues
  per lane based on focus; entering/leaving a lane writes ledger events.
- Mic exclusivity: the mic binds to one lane; moving it asks for confirmation; keyboard M.
- Ladder display: 4 stages, countdown to next stage, halted / suppressed / complete states;
  H halts. (The real ladder runs server-side later; in phase 1 the mock layer simulates it.)
- Wall locked while incidents are open.
- Close requires a memo (min length), then next-steps queue + optional report view.
- Priority order in the queue: inside property line > watch index > age.

## Architecture requirements

- **API client layer**: one typed module, mock implementation behind it. Entities:
  Site, Camera, Alert, Incident, WatchScore, LedgerEvent, EvidenceStill, LadderState,
  TranscriptLine. Propose the TypeScript types as part of the task; we will turn them into
  the backend contract.
- **VideoSlot component**: placeholder in phase 1, but with a defined props interface
  (camera id, quality tier full/sub). It will become a WebRTC player (go2rtc, same layer
  as the existing surveillance platform), so keep it isolated.
- State updates arrive as events (the mock layer can tick like the demo does); design the
  store so a WebSocket can replace the mock ticker without touching components.
- Auth: none in phase 1; an OTP login gate (existing Lionston pattern) will be added at
  integration.
- Responsive per the mockup's breakpoints (1180px, 980px). Desktop-first; the console is
  a desk tool.

## Deliverables

1. UX/UI review notes with Oleg (before coding) — for my sign-off.
2. The React app running on mock data, matching the mockup's behaviours above.
3. Proposed TypeScript API types + a short README (run instructions, structure).

## Out of scope for phase 1

Real video, real alerts, TTS/voice, auth, report PDF generation, multi-desk paging.
Everything simulated by the mock layer is fine.

Questions: message me anytime. Anything ambiguous in the mockup, ask instead of guessing.
