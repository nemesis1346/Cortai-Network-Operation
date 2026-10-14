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
`peripheral`/`escalated`/`closing`/`handoff-requested`/`closed`), and take-next/raise-incident command
shapes. Blocked on the Lane Workspace / camera-wall Figma call, not on anything in this document. (The
wall staying open during an incident shipped in Part 4 ahead of that call, per `DECISIONS.md`'s 5 Oct
note — flagged there as carrying build risk until Marco confirms it with Oleg.) See `DECISIONS.md` for
the full status of every item from the sign-off memo.

## 13. Camera status: Fault vs. Offline (resolved, v2 Part 4)

~~v2's `EstateStat` component shows four per-estate totals: Live, Motion, Fault, Offline. `CameraStatus`
only has three values, with no field distinguishing fault from offline.~~ **Resolved 12 Oct**:
`STATES.md` §7 (missed in the initial Part 3 scan) already defines both — fault = degraded stream, still
live, flagged to maintenance; offline = no signal, speaker/deterrents may be unavailable. Needed for real
once `CameraWall`'s own filter tabs (`'all'|'live'|'motion'|'fault'|'offline'`) made the distinction
unavoidable, not optional. `CameraStatus` is now `'live' | 'motion' | 'fault' | 'offline'`; seed data
splits the one down camera (`434 N Rivermede`) into one of each (`12` fault via `signal: 'degraded'`,
`19` offline via `signal: 'lost'`) so both paths are exercised, not just typed.

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

**12 Oct — v2 Part 4 (camera wall):**
- `src/api/types.ts`: `CameraStatus` is now `'live' | 'motion' | 'fault' | 'offline'` — see §13.
- `src/api/mock/data.ts`: seed camera `12` set to `fault` (`signal: 'degraded'`), `19` to `offline`
  (`signal: 'lost'`), proving both paths instead of one blended `down`.
- `src/store/selectors.ts#cameraSummary`: now an exclusive partition (`live` no longer includes motion
  cameras — see `V2-BUILD-PLAN.md`'s Part 4 "byproduct" note). New `camerasForWall` +
  `CAMERA_WALL_ORDER` for the wall's "motion, fault, offline, then live" grouping.
- `src/components/TopBar.tsx`: health pill computes `total - fault - offline` inline instead of reading
  a pre-blended `live`; "N camera fault" relabelled "N camera issue(s)" (now covers two failure modes).
- `src/components/EstateTree.tsx`: `EstateStats` gained its 4th tile (Offline) for free once the type did.
- `src/components/CameraWall.tsx` (new): replaces `CameraRibbon.tsx` outright. Status-tab filter with
  counts, `CameraTile` opens the owning lane (and closes the wall) or toasts that camera view without an
  incident isn't built yet (Part 7). `W` hotkey added (`useHotkeys.ts`, `ShortcutsLegend.tsx`).
- `src/store/store.ts#toggleWall`: no longer refuses while incidents are open (deviations#13); new
  `UiState.wallFilter` + `setWallFilter`.
- `src/styles/layout.css`: `.cams-region`'s vestigial `position: relative` removed — see the real-bug note
  in `V2-BUILD-PLAN.md`'s Part 4 notes, this was silently breaking the wall overlay's positioning.

Verified live: wall opens with an incident active (no lock), tab counts and "motion, fault, offline,
live" tile ordering matched seed data exactly, filtering by status worked, clicking a lane-owned tile
focused that lane and closed the wall, clicking an unowned camera's tile toasted instead of doing
nothing. One real bug found and fixed before this passed — see `V2-BUILD-PLAN.md`'s Part 4 notes.

Typecheck clean, 29/29 tests passing throughout.

**13 Oct — v2 Part 5 (comms dock):**
- `src/hooks/useHoldToTalk.ts` (new): press/release with no arm delay — distinct from `useHoldToArm`'s
  600ms. `pressing` is local-only UI state; the caller decides whether a press needs a server call.
- `src/components/LaneWorkspace.tsx`: Talk button's press calls `store.toggleMic(inc.id)` only when this
  lane doesn't already own the mic — never falls into `toggleMic`'s release branch on a press, which
  would have turned "hold to talk" into "every other press hangs up." `M` key and CommsDock's own "Move
  mic here" both still call `toggleMic` unconditionally, unchanged. Watch column gained a Timeline/
  Transcript tab pair (`watchTab` local state); Evidence stays always-visible, not a tab.
- `src/components/CommsDock.tsx` (new): mic routing ("Mic open to this lane" / "Mic open to Lane X" +
  Move mic here / "Mic unbound" + Move mic here), waveform, last transcript line for this incident
  (click switches the watch column to its Transcript tab). Lives inside `LaneWorkspace`, not global.
- `src/components/StatusBar.tsx` (new), replacing `src/components/VoiceStrip.tsx` (deleted) as the
  global footer: just Mic (which lane, or Unbound) and Sirens (which lanes, or None running).
- `src/components/Lanes.tsx`: `LaneWorkspace` now takes `key={focused.id}` — see the real-bug note in
  `V2-BUILD-PLAN.md`'s Part 5 notes.
- `src/styles/layout.css`: `.voice`/`.voice-strip`/`.vs-*`/`.transcript`/`.jump-latest` removed; added
  `.status-bar`/`.sb-item`, `.comms-dock`/`.cd-*`, `.ws-tabs`, `.action-talk.talking`. `.tline`/`.wave`/
  `.speaker-dot` kept, now shared between the transcript tab panel and CommsDock.

Verified live: old voice-strip DOM confirmed gone; StatusBar reads "Mic: Unbound · Sirens: None running"
with nothing open; pressing Talk shows the talking-pulse immediately and CommsDock updates to "Mic open
to this lane" with the live transcript line; releasing keeps the binding (`aria-pressed` stays true);
re-pressing while already bound adds no duplicate transcript line; switching lanes while the mic is
bound elsewhere still correctly opens the pre-existing MicConfirmDialog rather than switching (unrelated,
unchanged flow — confirmed not regressed). One real bug found and fixed: `LaneWorkspace` had no `key`,
so a lane switch didn't remount it and local state (note draft, now also the watch-tab) leaked across
lanes; fixed with `key={focused.id}`, re-verified clean.

Typecheck clean, 29/29 tests passing throughout (no new domain/store logic this part — the mic-claim
guard is component-level, same precedent as the queue/wall filters in Parts 3-4).

**14 Oct — v2 Part 6 (named ladder + closeout fit):**
- `src/api/types.ts`: `LadderStageDef.atSec` is now optional — absent for Dispatch ("never automatic",
  v2 STATES.md §3).
- `src/domain/constants.ts#LADDER_STAGES`: Talk-down/Siren/Keyholder/Dispatch, firing at
  `UNATTENDED_NOTICE/WARNING/ALARM_SEC` (30/45/60s) — reusing those constants directly, not duplicating
  the numbers, since the alignment with the self-escalation clock is deliberate. Dispatch has no `atSec`.
- `src/api/mock/MockNocClient.ts`: `openIncident` now starts the ladder `'armed'` (previously `'running'`
  immediately) — wires up a status that existed in the type since before this part but was never set.
  `fireStage` rewritten for 3 stages only (0-2); Siren (1) auto-arms `inc.siren` without the halt side
  effect `setSiren` has (that's for an operator override, not the ladder's own progression); Keyholder
  (2) queues a call, no AI speech. New `confirmDispatch(incidentId)`: sets `firedStage=3`, `status=
  'complete'`, available any time short of already-complete — including on a suppressed ladder, matching
  `setSiren`/`setStrobe`'s lack of a status guard (see the real-bug note in `V2-BUILD-PLAN.md`'s Part 6
  notes for why the first version wrongly excluded suppressed). `haltLadderInternal`'s guard extended to
  the new `'armed'` status.
- `src/domain/timing.ts#secondsToNextStage`: skips stages with no `atSec` when finding "next" — returns
  null once only Dispatch is left, instead of crashing on `undefined - t`.
- `src/api/mock/data.ts`: `STAGE_SCRIPT` removed (the old 4 spoken lines no longer apply — Talk-down's
  content is `buildCallout`, the other 3 stages don't speak). 3 Tait Street's `ladderAtSec` override
  fixed to produce a full 4-stage array with Dispatch kept un-timed regardless of the override.
- `src/components/LaneWorkspace.tsx`: Confirm Dispatch button in `.ladder-controls`, destructive styling,
  dimmed (not disabled) for P3/P4, in-app confirm dialog (no native `confirm()`, audit C7 discipline).
- `src/components/CloseoutModal.tsx`: recap's "Voice stages played: N of 4" (meaningless once stages
  have names and Dispatch has no fixed total) is now "Ladder reached: {stage name}".
- `src/store/store.ts`: `confirmDispatch` wired through; new `notifyLadderAdvance` toasts when a
  *peripheral* lane's ladder reaches Keyholder (v2 STATES.md §3) — Dispatch is excluded from this by
  construction, since it's only reachable via the focused lane's own button.

Verified live: full progression through Armed → Talk-down (30s) → Siren auto-arms without halting (45s)
→ Keyholder, countdown stops since Dispatch has no atSec (60s); Confirm Dispatch's dialog, Cancel
leaving the ladder untouched, Confirm producing the transcript line and flipping to Complete; the
dispatch button dimmed for P3/P4 and available (not hidden) for a suppressed lane; a peripheral lane's
Keyholder toast; the closeout recap's real stage name. StatusBar's Sirens field updated from the
ladder's own auto-arm, confirming it isn't wired only to the manual path.

Typecheck clean, 37/37 tests passing (7 new: armed-on-open, Talk-down firing, Siren auto-arm without
halting, Dispatch never auto-firing, confirmDispatch any time, confirmDispatch on a suppressed ladder,
the peripheral-lane toast).
