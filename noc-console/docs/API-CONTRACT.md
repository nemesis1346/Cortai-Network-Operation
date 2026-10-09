# API & event contract — draft

Status: engineering draft, mine to own (`OPEN-QUESTIONS.md` #9–13 in `docs-v2/`), updated 2 Oct with
Yassine's decisions from the [sign-off memo](https://claude.ai/artifact/NExg3jmFhJS6pUpg1x9b2W) — see
`DECISIONS.md` for the full log. Everything here extends `src/api/types.ts` / `src/api/client.ts`, the
contract he already has from phase 1.

Cross-references: `docs-v2/docs/STATES.md` (every v2 transition, timer and side effect),
`docs-v2/docs/OPEN-QUESTIONS.md` (the items this document answers), `src/api/types.ts` (source of
truth for shapes — this document explains and extends it, never duplicates it silently out of sync).

## 1. Scope: what this does and doesn't decide

This is a transport and data contract. The queue sort formula is now decided and **implemented**
(`domain/rules.ts#derivePriority`, §1a below) — it was the one open item that was pure domain logic,
independent of which interaction model ships. The interaction model itself and the auth flow are still
open, pending the Lane Workspace / camera-wall Figma call. Building the endpoints below doesn't require
those answers; building the *screens* that call them does.

Not touched here, on purpose: `Incident` lifecycle shape, any `LaneState` machine. Those stay with the
still-open interaction model.

### 1a. Queue priority (decided, implemented)

P1–P4 is computed, never set by hand: `derivePriority(severity, insidePropertyLine)` in
`domain/rules.ts`. `severity` (renamed from the old `priority` field — `AlertSeverity` in `types.ts`) is
the AI's raw event-type classification, 1–3; inside bumps nothing, outside drops one tier, floored at P4:

| | inside the line | outside |
|---|---|---|
| severity 1 | **P1** | P2 |
| severity 2 | P2 | P3 |
| severity 3 | P3 | **P4** |

Full sort: P1→P4, then watch index (descending), then age (oldest first) — same lexicographic structure
phase 1 already had, with the computed priority inserted as the new primary key ahead of watch index.

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

## 11. What changed in code

**29 Sep — video contract (§7):**
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
the detection's own label and confidence; the two-person alert renders two boxes at once.

**2 Oct — Yassine's decisions:**
- Queue priority (§1a): `Alert.priority` renamed `severity` (`AlertSeverity`); `derivePriority` +
  updated `compareAlerts` in `domain/rules.ts`; `Queue.tsx` reads the computed P1–P4, not the raw field.
- Hold action: `NocClient.holdAlert`, implemented in `MockNocClient`, a "Hold" button on every `New`-tab
  queue row (only state transition it allows: `new` → `held`).
- Page second desk: `NocClient.requestDeskPage`, a third button in the lane-limit refusal banner,
  produces its own `desk.paged` event distinct from the existing auto-page-at-stage-3 mechanism.
- Per-site ladder timing: `Site.ladderStages?` overrides the global default; seeded on 3 Tait Street
  (`[0, 8, 20, 35]` vs. the `[0, 12, 30, 45]` default) to prove it's wired, not just typed.
- IBM Plex Sans + Mono replaces Archivo + JetBrains Mono as the default pairing (`--font-body`/
  `--font-mono` tokens in `tokens.css`), approved deviation, orthogonal to the two still-open items.

Verified live: queue rows show the derived P1–P4 (not the raw severity); holding an alert moves it to
the Held tab without opening a lane; the refusal banner's two buttons both work, and paging produces a
`CriticalBand` entry distinct from an auto-page; two lanes opened on different sites show different
ladder countdowns at the same tick (8s vs. 12s to next stage), confirming the per-site override is live,
not coincidental; the page renders in IBM Plex Sans.

Typecheck clean, 20/20 tests passing throughout.

## 12. Explicitly not started

Auth model (OTP flow still to arrive from Yassine), the `LaneState` machine (`free`/`focused`/
`peripheral`/`escalated`/`closing`/`handoff-requested`/`closed`), take-next/raise-incident command
shapes, and whether the camera wall stays open during an incident. All blocked on the Lane Workspace /
camera-wall Figma call, not on anything in this document. See `DECISIONS.md` for the full status of
every item from the sign-off memo.

## 13. Camera status: Fault vs. Offline (open gap, v2 Part 3)

v2's `EstateStat` component (`docs-v2/docs/COMPONENTS.md`) shows four per-estate totals: Live, Motion,
Fault, Offline. `CameraStatus` (`types.ts`) only has three values — `'live' | 'motion' | 'down'` — with
no field distinguishing a camera that's live but reporting a fault from one that's genuinely
unreachable. `src/components/EstateTree.tsx` renders three totals (Live/Motion/Fault) rather than
inventing a fourth bucket with no backend signal behind it.

Question for Oleg/backend before this can be built for real: is Offline a real 4th `CameraStatus` value
(camera unreachable at the network level), or is it `down` plus a reason code (e.g. `downReason:
'fault' | 'offline'`)? Either is a small, additive change to `types.ts` once answered — not blocking
anything else in the build plan.

## 14. What changed in code, continued

**9 Oct — v2 Part 3 (estate tree + queue adjustments):**
- `src/components/EstateTree.tsx`: added the `EstateStats` totals row (Live/Motion/Fault — see §13) and
  per-camera down duration (moved from the old ribbon's fault list, not dropped).
- `src/components/CameraRibbon.tsx`: pip strip and fault list removed (duplicated the estate tree, audit
  A9); kept the wall toggle + overlay, which Part 4 replaces outright.
- `src/components/Queue.tsx`: added an `All`/`P1–P2` `SegmentedControl` below the existing New/Working/
  Held tabs — additive, not a replacement; see `DECISIONS.md` #4 and `V2-BUILD-PLAN.md`'s Part 3 notes
  for why the tabs themselves don't change.
- `src/store/store.ts`: new `UiState.queuePriorityFilter` ('all' | 'high') + `setQueuePriorityFilter`.
- `src/store/selectors.ts#cameraSummary`: reused for the new totals row (previously computed inline in
  `CameraRibbon.tsx`, now has one real caller).

Verified live: totals matched seed data (10 live / 2 motion / 1 fault); down camera's row showed a live
countdown; old `.pip`/`.faults` markup confirmed absent from the DOM; priority filter narrowed New-tab
rows to P1/P2 only and restored correctly on switching back. No real bugs found.

Typecheck clean, 29/29 tests passing throughout.
