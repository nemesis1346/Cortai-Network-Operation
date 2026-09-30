# API & event contract — draft

Status: engineering draft, mine to own (`OPEN-QUESTIONS.md` #9–13 in `docs-v2/`). Doesn't depend on
Yassine's v2 sign-off — everything here extends `src/api/types.ts` / `src/api/client.ts`, the contract
he already has from phase 1, and nothing here commits to a v2 interaction-model decision.

Cross-references: `docs-v2/docs/STATES.md` (every v2 transition, timer and side effect),
`docs-v2/docs/OPEN-QUESTIONS.md` (the five items this document answers), `src/api/types.ts` (source of
truth for shapes — this document explains and extends it, never duplicates it silently out of sync).

## 1. Scope: what this does and doesn't decide

This is a transport and data contract. It does not choose the interaction model, the queue sort
formula, or the auth flow — those are the two blockers and the eight open questions in the
[sign-off memo](https://claude.ai/artifact/NExg3jmFhJS6pUpg1x9b2W). Building the endpoints below
doesn't require those answers; building the *screens* that call them does.

Not touched here, on purpose: `Alert.priority`, `Incident` lifecycle shape, any P1–P4 model, `LaneState`.
Those are exactly the things still open.

## 2. Transport

REST for commands (request/response, a result the operator is waiting on), WebSocket for everything
else (state changes other operators or the ladder itself cause). This matches the shape `NocClient`
already has — `getSnapshot()` is the REST "give me everything" call, `subscribe()` is the WebSocket
event stream, and every other method is a command. A real client only needs to implement `NocClient`;
nothing in the store or components needs to change.

```
GET  /api/snapshot                 -> Snapshot   (NocClient.getSnapshot)
WS   /api/events                   -> ServerEvent stream (NocClient.subscribe)
POST /api/incidents                -> open an incident from an alert
POST /api/incidents/:id/close      -> close
POST /api/incidents/:id/focus      -> (see note below — focus is desk-local, see §3)
POST /api/incidents/:id/mic        -> bind/release the mic
POST /api/incidents/:id/ladder/halt
POST /api/incidents/:id/siren
POST /api/incidents/:id/strobe
POST /api/incidents/:id/notes
POST /api/pages/:desk/ack
```

## 3. Commands: existing vs. anticipated

| `NocClient` method | Endpoint above | Notes |
|---|---|---|
| `openIncident` | `POST /incidents` | Idempotent — see §6 |
| `closeIncident` | `POST /incidents/:id/close` | Idempotent — see §6 |
| `setFocus` | — | **Desk-local, not a server command.** Focus is "what this operator is looking at right now," not shared state. Keep it client-side (as the store already does) rather than round-tripping it; only the *ledger event* it produces ("Operator entered lane") needs to reach the server. |
| `bindMic` | `POST /incidents/:id/mic` | `{ incidentId: string \| null, force?: boolean }` |
| `haltLadder` | `POST /incidents/:id/ladder/halt` | |
| `setSiren` / `setStrobe` | `POST /incidents/:id/siren` / `/strobe` | `{ on: boolean }` |
| `addNote` | `POST /incidents/:id/notes` | `{ text: string }` |
| `acknowledgePage` | `POST /pages/:desk/ack` | |

Anticipated, not in `NocClient` yet — v2's `STATES.md` §1 implies these regardless of which interaction
model ships, but their request/response shape depends on the queue-formula and lane-model decisions,
so they're named here and not typed yet:

- **Take next** / **Raise incident** (manual P1–P4 raise from a camera with no alert) — `STATES.md` §1.
- **Acknowledge escalation** (K) — distinct from `haltLadder`; acknowledges without stopping the ladder.
- **Hand off** / **accept hand-off** — two-sided, needs a supervisor-facing endpoint too.
- **Confirm dispatch** — `STATES.md` §3, stage 4 is never automatic; this is a dedicated confirm step,
  not folded into ladder progression.

## 4. Events: existing vs. anticipated

The current `ServerEvent` union (`alert.upsert`, `incident.upsert`, `incident.closed`, `ladder.updated`,
`ledger.added`, `evidence.added`, `transcript.added`, `camera.updated`, `watch.updated`, `focus.changed`,
`mic.changed`, `speaker.changed`, `desk.paged`, `desk.page.acknowledged`) covers everything phase 1's
UI reduces. Kept as-is.

Anticipated additions, mapped from `STATES.md`:

| Event | From | Payload sketch |
|---|---|---|
| `lane.escalated` | §1, §2 (30/45/60s) | `{ incidentId, level: 'notice'\|'warning'\|'alarm' }` |
| `lane.acknowledged` | §1 (K) | `{ incidentId, by: Operator }` |
| `video.signal.changed` | §5 | `{ cameraId, signal: VideoSignal, latencyMs? }` — **the client-side shape for this already exists**, see §7 |
| `connection.changed` | §8 | `{ state: 'online'\|'offline' }` |
| `session.changed` | §7 | `{ state: 'active'\|'locked'\|'signed-out' }` |

`camera.updated` could absorb `video.signal.changed` instead of a new event type, since `Camera` already
carries `signal`/`latencyMs` as of today's change (§7) — worth deciding when the video contract is
finalized rather than shipping two events for one fact.

## 5. Error codes

Current `ErrorCode` (`LANE_LIMIT`, `MIC_BUSY`, `MEMO_TOO_SHORT`, `NOT_FOUND`, `INVALID_STATE`) stays.
Anticipated additions once auth and offline handling are real: `OFFLINE` (§8 — refused, never queued,
per `STATES.md`), `ACCOUNT_LOCKED` (§7 — 5 failed sign-ins), `SESSION_LOCKED`. Not added to the type yet
— an error code with no path that produces it is dead code, and none of these can fire until auth/offline
are built.

## 6. Idempotency for take and close

Both are the two commands where a retried request must never double-apply: taking the same alert twice
must not open two incidents, closing twice must not double-log the memo. Proposal: the client generates
a UUID per attempt and sends it as `Idempotency-Key`; the server keeps a short-lived (5 min) map of
key → response and replays the original response for a repeat instead of re-executing. `openIncident`
already has this for free client-side (`MockNocClient.openIncident` returns the existing incident if one
exists for that `alertId`) — the real server needs the same guarantee across a network retry, not just
across a double-click.

## 7. Video contract

**Shipped today**, not just proposed: `Camera.signal` / `Camera.latencyMs` and `Alert.detections` exist
in `src/api/types.ts`, and `VideoSlot` renders the bounding-box overlay and a latency OSD tag from them
instead of the fixed CSS position it had before. The mock seeds `signal: 'live'`, `latencyMs: 120` and a
real `Detection` per alert (`box` as `[x, y, w, h]`, each 0..1 of the frame — the same convention v2's
`VideoStageProps.detections` uses, so a real detector's output needs no translation layer). `signal` is
typed as `'live' | 'degraded' | 'lost' | 'connecting'` but the mock only ever produces `'live'` — the
other three are wired through the prop chain and ready for a real player, not yet exercised by any UI
state, since shipping an unreachable, unverified visual state isn't something I'll do without a way to
actually trigger and check it.

Open, for backend:

- **Latency budget.** `docs-v2` cites 140ms in its prototype; phase 1's mock uses 120ms as a placeholder,
  not a target. Needs a real number from whoever specs the go2rtc path.
- **Reconnect policy.** `STATES.md` §5: degraded at 3fps/900ms frame gap, lost at 5s with no frames,
  auto-reconnect countdown or manual retry back to `connecting`. Reasonable defaults, need confirming
  against the real transport.
- **Sub-stream usage.** Full tier for the focused lane, sub for everything else (lane cards, wall) —
  already the phase-1 convention (`tier: 'full' | 'sub'` on every `VideoSlot` call), just needs the real
  bitrate/resolution pair decided per tier.

## 8. Audio alarm spec (proposed, nothing built)

No sound exists anywhere in phase 1 — correctly out of scope per the original brief. Recommendation for
whenever it's scoped in: three distinguishable signals, matching the acceptance-checklist item this
project already tracks toward (audit A19) — new P1/P2 arrival, ladder reaching stage 4 (dispatch) on an
unattended lane, connection lost. Volume and mute belong in a settings surface, not a global constant;
repeat/escalation behavior (does a new-P1 chime repeat until acknowledged?) is a product call, not an
engineering one — add to the sign-off memo's open-questions list if/when this gets scoped.

## 9. Time & locale (recommendation)

Wire format stays ISO-8601 UTC (`ISODate` in `types.ts` already, unchanged). Display: site-local time,
not desk-local — matches `STATES.md`'s "all times are site-local" and is the only choice that makes
"After hours" chips and ladder timestamps mean the same thing regardless of where the operator's desk
physically sits. Needs: each `Site` gaining an IANA timezone field when this is built for real: not
present in `types.ts` today because nothing in phase 1's UI needs to convert a timestamp yet (everything
renders relative — `fmtClock`, `age` — or as the desk's own local clock, which is correct for the shift
clock specifically since that's about the operator's shift, not the site).

## 10. Offline behaviour (recommendation, grounded in `STATES.md` §8)

Site-affecting actions (take, talk, siren, strobe, raise, dispatch) refused while offline, never queued
— queuing a siren command against a site you can't currently reach is a worse failure mode than telling
the operator no. Notes are the one exception: buffered locally, flushed on reconnect, since a note is a
record of what the operator observed, not an action against the site. Needs from backend: the heartbeat
timeout that actually triggers the `offline` state — `STATES.md` doesn't give a number, and neither do I.

## 11. What changed in code today

- `src/api/types.ts`: added `Detection`, `VideoSignal`; `Camera` gained `signal?`/`latencyMs?`;
  `Alert` gained `detections?`.
- `src/api/mock/data.ts`: every live camera seeds `signal: 'live'`, `latencyMs: 120`; every alert with a
  confidence value seeds a matching `Detection` (two for the "two on foot" alert).
- `src/components/VideoSlot.tsx`: now owns its own bounding-box overlay and latency tag, reading from
  the new props, instead of the parent lane hardcoding a fixed-position box.
- `src/components/Lane.tsx`: looks up the incident's camera and passes `signal`/`latencyMs`/`detections`
  through; removed the hardcoded `<div className="bbox">`.
- `src/styles/layout.css`: `.bbox` no longer hardcodes a position (comes from inline style now); added
  `.video-latency`.

Verified live: two different alerts render two visibly different, independently-positioned boxes with
the detection's own label and confidence; the two-person alert renders two boxes at once; typecheck and
all 17 tests still pass.

## 12. Explicitly not started

Queue sort formula, auth model, the `LaneState` machine (`free`/`focused`/`peripheral`/`escalated`/
`closing`/`handoff-requested`/`closed`), take-next/raise-incident command shapes, and whether the camera
wall stays open during an incident. All blocked on the sign-off memo, not on anything in this document.
