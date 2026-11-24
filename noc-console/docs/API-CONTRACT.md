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
independent of which interaction model ships.

~~The interaction model itself and the auth flow are still open~~ **Resolved:** both are built (v2 Parts
1–9) and approved (Yassine, 23 Nov). The lane state machine is §15, the alert state machine §15a, and
every endpoint, auth included, is §2. Only the session transport (§2e) and hand-off (§3) are still open.

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
else (state changes the ladder, the AI or other desks cause). This matches the shape `NocClient`
already has: `getSnapshot()` is the REST "give me everything" call, `subscribe()` is the WebSocket event
stream, and every other method is a command. A real client only needs to implement `NocClient`; nothing
in the store or components needs to change.

This section is the complete endpoint reference (completed 24 Nov per Yassine's 23 Nov request: "one
document the backend can be built from without reading the code"). Every `NocClient` method has exactly
one row in §2b–§2d; the shapes they name are in Appendix A, verbatim from `src/api/types.ts`.

### 2a. Conventions (all endpoints)

- **Base path** `/api`. JSON in and out (`Content-Type: application/json`), UTF-8. Timestamps are
  ISO-8601 UTC strings (`ISODate` in Appendix A). Ids are opaque strings.
- **Every response body is a `Result<T>`, literally** (Appendix A), so the client does no translation:

  ```
  200  { "ok": true,  "value": <T> }                 // T is null for commands with nothing to return
  4xx  { "ok": false, "error": { "code": "...", "message": "...", ...extra fields } }
  ```

  The client branches on `error.code`, never on the HTTP status. The status exists for proxies, logs
  and retries. `message` is operator-facing English, shown as-is in a toast. The extra fields are
  `micOwnerIncidentId` (`MIC_BUSY`), `attemptsLeft` (`INVALID_CODE`) and `retryAfterSec`
  (`EMAIL_LOCKED`, `RATE_LIMITED`, `RESEND_TOO_SOON`).
- **Status per error code:**

  | `code` | HTTP | Extra fields | Also send |
  |---|---|---|---|
  | `NOT_FOUND` | 404 | | |
  | `INVALID_STATE` | 409 | | |
  | `LANE_LIMIT` | 409 | | |
  | `MIC_BUSY` | 409 | `micOwnerIncidentId` | |
  | `MEMO_TOO_SHORT` | 422 | | |
  | `INVALID_CODE` | 422 | `attemptsLeft` | |
  | `CODE_EXPIRED` | 422 | | |
  | `EMAIL_LOCKED` | 423 | `retryAfterSec` | `Retry-After` header |
  | `RATE_LIMITED` | 429 | `retryAfterSec` | `Retry-After` header |
  | `RESEND_TOO_SOON` | 429 | `retryAfterSec` | `Retry-After` header |
  | `UNAUTHENTICATED` *(proposed, §2e)* | 401 | | |
  | `BAD_REQUEST` *(proposed, §2e)* | 400 | | |

- **Idempotency.** `POST /api/incidents` and `POST /api/incidents/:id/close` take an `Idempotency-Key`
  header (a UUID the client generates per user action and reuses on every retry of it). The server keeps
  key → response for 5 minutes and replays the stored response for a repeat instead of re-executing it.
  See §6. Every other command is either naturally idempotent (setting a value) or harmless to repeat.
- **Session.** Every endpoint except `POST /api/auth/code` and `POST /api/auth/verify` requires a
  signed-in session, and the WebSocket does too. How the session is carried is §2e.
- **Events.** Commands don't return the state they changed beyond their own `value`. Every state
  change also arrives on the socket as a `ServerEvent` (§17), which is what the store actually reduces.
  A client that ignored command responses entirely would still end up in the right state.

### 2b. Session and auth (Part 8)

Email-code (OTP) sign-in, then a desk pick. Limits, all constants in `src/domain/constants.ts`:

| Rule | Value |
|---|---|
| Code length | 6 digits |
| Code valid for | 10 min |
| Resend cooldown | 30 s between codes for the same email |
| Codes per email | 5 per rolling hour |
| Wrong codes before lock | 3. The 3rd burns the code and locks the email |
| Email lock | 15 min. Applies to both requesting and verifying |
| Idle lock (client-side) | 15 min of no input locks the screen. The server isn't involved |

| Endpoint | `NocClient` | Request | Success `value` | Errors |
|---|---|---|---|---|
| `POST /api/auth/code` | `requestCode` | `{ "email": string }` | `{ "resendAfterSec": number }` | `EMAIL_LOCKED`, `RESEND_TOO_SOON`, `RATE_LIMITED` |
| `POST /api/auth/verify` | `verifyCode` | `{ "email": string, "code": string }` | `{ "operator": AuthOperator }` | `INVALID_CODE`, `CODE_EXPIRED`, `EMAIL_LOCKED` |
| `POST /api/auth/desk` | `selectDesk` | `{ "deskId": number }` | `null` | `INVALID_STATE` (no verified code yet), `NOT_FOUND` (desk not in `operator.desks`) |
| `POST /api/auth/lock` | `lock` | none | `null` | `INVALID_STATE` (no active session) |
| `POST /api/auth/sign-out` | `signOut` | none | `null` | none: always succeeds, even with no session |

What each one must do:

- **`/auth/code`** accepts *any* email and answers the same way whether or not it belongs to an
  operator, so the endpoint can't be used to discover which emails exist. Checks run in this order:
  email locked → `EMAIL_LOCKED`; last code under 30 s ago → `RESEND_TOO_SOON`; 5 codes already sent in
  the last hour → `RATE_LIMITED` (its `retryAfterSec` counts to when the oldest of the 5 ages out).
  Otherwise it sends a fresh code and answers `{ resendAfterSec: 30 }`, which the UI uses for its
  resend countdown.
- **`/auth/verify`**: email locked → `EMAIL_LOCKED`. Correct code → resets the wrong-attempt counter and
  returns the operator (`AuthOperator`: id, name, and the desks they may sign into). Expired code →
  `CODE_EXPIRED`, which does **not** count as a wrong attempt: the operator mistyped nothing
  (`DECISIONS.md`, 3 Nov). Wrong code → `INVALID_CODE` with `attemptsLeft`. The 3rd wrong code returns
  `EMAIL_LOCKED` with `retryAfterSec: 900` instead, burns the code and resets the counter. A correct
  code is single-use.
- **`/auth/desk`** turns the verified operator into a session on that desk. Only desks listed in
  `operator.desks` are allowed.
- **Unlocking** has no endpoint of its own (`DECISIONS.md`, 3 Nov): the lock screen re-runs
  `/auth/code` + `/auth/verify` for the session's own email, and a successful verify while that same
  operator's session exists simply keeps the session. No desk re-pick.
- **`/auth/lock`** changes nothing server-side. Lanes, ladders, timers and paging all keep running while
  the screen is locked (`STATES.md`). It exists for the audit log: record who locked which desk, when.
- **`/auth/sign-out`** ends the session (§2e). It does not close the desk's open incidents. Their
  ladders keep running server-side, the same as during a lock.

### 2c. State and records

| Endpoint | `NocClient` | Request | Success `value` | Errors |
|---|---|---|---|---|
| `GET /api/snapshot` | `getSnapshot` | none | `Snapshot` | none beyond the session check |
| `WS /api/events` | `subscribe` | none | stream of `ServerEvent` (§17), one JSON object per message | none beyond the session check (§2e) |
| `GET /api/incidents/:id/record` | `getRecord` | none | `IncidentReport` | `NOT_FOUND` (never existed, or still open) |

- **The snapshot is the full desk state**, built server-side at the moment of the call. The client
  loads it on connect and again after every reconnect, then applies socket events on top. That's how
  it resyncs after a drop without replaying missed events.
- **The record is sealed at close and never changes** (Part 9). The server stores the exact
  `IncidentReport` that `close` returned and serves that copy, not a rebuild: by the time History
  reopens it, the live `Incident` it came from (ladder, siren/strobe, visits) is gone. It's safe to
  send `Cache-Control: private, immutable`. Retention is still a placeholder (`DECISIONS.md` #8).

### 2d. Commands

| Endpoint | `NocClient` | Request | Success `value` | Errors |
|---|---|---|---|---|
| `POST /api/incidents` | `openIncident` | `{ "alertId": string }` + `Idempotency-Key` | `Incident` | `NOT_FOUND`, `INVALID_STATE` (alert closed, §15a), `LANE_LIMIT` |
| `POST /api/incidents/raise` | `raiseIncident` | `{ "cameraId": string, "priority": "P1"\|"P2"\|"P3"\|"P4" }` | `Incident` | `NOT_FOUND` (camera), `LANE_LIMIT` |
| `POST /api/alerts/:id/hold` | `holdAlert` | none | `null` | `NOT_FOUND`, `INVALID_STATE` (alert not `new`) |
| `POST /api/incidents/:id/close` | `closeIncident` | `{ "memo": string, "nextSteps": NextStepId[] }` + `Idempotency-Key` | `IncidentReport` | `NOT_FOUND`, `MEMO_TOO_SHORT` |
| `POST /api/focus` | `setFocus` | `{ "incidentId": string \| null }` | `null` | `NOT_FOUND` |
| `POST /api/mic` | `bindMic` | `{ "incidentId": string \| null, "force"?: boolean }` | `null` | `NOT_FOUND`, `MIC_BUSY` (+ `micOwnerIncidentId`) |
| `POST /api/incidents/:id/ladder/halt` | `haltLadder` | none | `null` | `NOT_FOUND` |
| `POST /api/incidents/:id/ladder/resume` | `resumeLadder` | none | `null` | `NOT_FOUND`, `INVALID_STATE` (not halted) |
| `POST /api/incidents/:id/dispatch` | `confirmDispatch` | none | `null` | `NOT_FOUND`, `INVALID_STATE` (ladder already complete) |
| `POST /api/incidents/:id/siren` | `setSiren` | `{ "on": boolean }` | `null` | `NOT_FOUND` |
| `POST /api/incidents/:id/strobe` | `setStrobe` | `{ "on": boolean }` | `null` | `NOT_FOUND` |
| `POST /api/incidents/:id/notes` | `addNote` | `{ "text": string }` | `null` | `NOT_FOUND`, `INVALID_STATE` (empty after trimming) |
| `POST /api/incidents/:id/escalation/ack` | `acknowledgeEscalation` | none | `null` | `NOT_FOUND`, `INVALID_STATE` (lane is focused) |
| `POST /api/pages` | `requestDeskPage` | `{ "reason": string }` | `null` | `INVALID_STATE` (a page is already waiting for acknowledgement) |
| `POST /api/pages/:desk/ack` | `acknowledgePage` | none | `null` | `NOT_FOUND` (no unacknowledged page for that desk) |

Behaviour a backend must reproduce, per command:

- **`openIncident`.** An alert that already has an open incident returns that incident (200), not an
  error and not a second lane. Otherwise checks run in this order: alert exists → alert not `closed`
  (§15a) → fewer than 3 lanes open (`LANE_LIMIT`). The new lane takes the lowest free lane index
  (0–2), the alert goes to `working`, and the ladder starts `armed` (or `suppressed` when the alert
  carries `suppressedReason`) using the site's own stage timings, else the default (`DECISIONS.md` #7).
  If no lane is focused, the new one takes focus.
- **`raiseIncident`.** Creates a synthetic alert, then runs `openIncident` unchanged. The priority →
  severity mapping is in §16.
- **`closeIncident`.** The memo is trimmed and must be at least 40 characters (`MEMO_TOO_SHORT`). On
  success: attended time is finalised, the mic is released if this lane held it, the Record is sealed
  (§2c), the alert goes to `closed` (§15a), the lane frees, and focus clears if this lane had it.
  `NextStepId` values are listed in Appendix A.
- **`setFocus`** is a real server command, not desk-local (this corrects §3's earlier note). It's where
  attention time is accounted: the lane losing focus banks its attended seconds and starts its
  unattended streak (`unattendedSince`, which escalation runs off, §15), the lane gaining focus clears
  it, and both get `enter`/`leave` ledger entries. `null` means "no lane focused" (camera view). Focus
  is per desk, not shared between operators. Re-focusing the already-focused lane is a no-op.
- **`bindMic`.** `incidentId: null` releases the mic and always succeeds. Binding while another lane
  holds the mic returns `MIC_BUSY` with the holder's id, unless `force: true`, which moves it. Binding
  the lane that already holds it is a no-op.
- **`haltLadder`** marks the incident operator-owned and halts an `armed` or `running` ladder. On a
  ladder that is already halted, suppressed or complete it leaves the ladder as it is and still succeeds.
  **`resumeLadder`** continues from the elapsed time at the halt, not from zero.
- **`confirmDispatch`** is stage 4, always the operator's explicit call, never automatic. It works on a
  suppressed ladder too: suppression stops only the automatic stages.
- **`setSiren(on: true)`** also halts the ladder: the operator has taken over the response.
- **`requestDeskPage`** pages the second desk. Only one page can wait for acknowledgement at a time.

### 2e. Session transport (proposed, needs Yassine's confirmation)

The mock has no notion of a token, so nothing in the code decides this yet. Proposal, consistent with
the endpoints above and standard for a same-origin web app:

- **A cookie, not a bearer token.** `/auth/verify` sets a short-lived `noc_pending` cookie (10 min,
  the same window as the code) naming the verified operator. `/auth/desk` swaps it for `noc_session`.
  `/auth/sign-out` clears both. All are `HttpOnly; Secure; SameSite=Strict; Path=/api`, so page
  scripts can't read them and other sites can't send them.
- **The WebSocket authenticates on the upgrade request**, with the same cookie (browsers send it
  automatically on a same-origin upgrade). No session → refuse the upgrade with 401. If the session
  ends while connected (sign-out elsewhere, expiry), the server closes the socket with code `4401`.
- **No session → `401` with `code: "UNAUTHENTICATED"`**, a new code. **Malformed request body →
  `400` with `code: "BAD_REQUEST"`**, also new. Neither is in `ErrorCode` yet: the mock can't produce
  them, and this project doesn't add codes nothing can raise (§5). They'll be added with the HTTP
  client (Yassine's point 3), which is the first thing that can produce them.
- **Client consequence.** Today `main.tsx` loads the snapshot *before* sign-in, which works only
  because the mock doesn't check. Against a real server the client must call `getSnapshot` and open
  the socket only after `/auth/desk` succeeds. Point 3 changes this.

If the Lionston flow Yassine mentioned on 1 Oct already fixes how sessions are carried (a bearer token,
a different cookie name, a session lifetime), that wins over this proposal. Only §2e would change: the
endpoints, bodies and error codes in §2b–§2d don't depend on it.

## 3. Commands: existing vs. anticipated

~~The per-method table that stood here~~ **was folded into §2b–§2d on 24 Nov**, which now has every
`NocClient` method with its endpoint, body, value and errors. Two rows changed on the way, not just moved:

- **`setFocus` is a real server command** (`POST /api/focus`), not desk-local as this table said. The
  table assumed focus was only "what the operator is looking at". In the built app it's also where
  attended/unattended time is banked and `unattendedSince` is set, which escalation runs off (§15). Both
  are server state, so the server has to see every focus change. Focus is still per desk, not shared.
- **`bindMic` is `POST /api/mic`**, not `/incidents/:id/mic`. Releasing the mic (`incidentId: null`)
  has no incident to put in the path.

~~Anticipated, not in `NocClient` yet~~ — **stale, v2 Part 10 (10 Nov): 3 of these 4 are already built**,
landed piecemeal across Parts 2/6/7 while this list sat unedited. Corrected:

| | Status |
|---|---|
| **Raise incident** (manual P1–P4 raise from a camera with no alert) | **Built**, Part 7 — `NocClient.raiseIncident(cameraId, priority)`. Shape and endpoint: §16. |
| **Take next** | **Resolved, not a separate command** — see §16. There's no "next" on the server; the operator clicks whichever queue row they want, which is already `openIncident(alertId)`, already in the table above. |
| **Acknowledge escalation** (K) | **Built**, Part 2 — `NocClient.acknowledgeEscalation(incidentId)` → `POST /api/incidents/:id/escalation/ack`. Sets `escalationAcked`, emits the existing `incident.upsert` (no new event type). |
| **Confirm dispatch** | **Built**, Part 6 — `NocClient.confirmDispatch(incidentId)` → `POST /api/incidents/:id/dispatch`. Ladder stage 4, operator-confirmed only, never automatic (fires `firedStage = 3`, `status: 'complete'`), emits `ladder.updated`. Available even on a suppressed ladder — that only stops the automated stages, not an explicit operator call. |
| **Hand off** / **accept hand-off** | **Still genuinely open** — the one real gap. Needs a supervisor-facing endpoint and a second operator identity to hand off *to*, neither of which exist (`DECISIONS.md` #6: single operator role, no role system until integration). Not the same thing as the already-built mic hand-off between a desk's own lanes (`bindMic`/`MicConfirmDialog`) — that's one operator moving their own attention, this would be operator-to-operator. |

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

**Resolved, v2 Part 10 (10 Nov): none of the 5 anticipated additions above are needed.** Each one looked
plausible from `STATES.md` alone; checking what Parts 1–9 actually built instead of what was anticipated
changed the answer for all five — full reasoning in §17. Short version: `lane.escalated`/
`lane.acknowledged` are redundant with the existing `incident.upsert` (escalation tier is computed
client-side every tick from `unattendedSince`/`escalationAcked`, both already on `Incident` and already
reaching the client via the event that's always fired when either changes — Part 2's own design, not
something Part 10 added); `video.signal.changed` is resolved in `camera.updated`'s favor, settling the
"worth deciding" note directly above — one fact, one event, no dual-sourcing to keep in sync;
`connection.changed` doesn't fit the event model at all, since a dead connection can't push an event
about itself — a real client detects this from the transport (WebSocket `close`/heartbeat timeout), not
a payload (§10 already says this is needed "from backend," it just didn't yet connect that to why no
event type works for it); `session.changed` turned out unnecessary once Part 8 built auth as pure
request/response (`requestCode`/`verifyCode`/`selectDesk`/`lock`/`signOut`, each returning its own
result) — nothing elsewhere needs to learn about a session change it didn't itself cause, since this
build has no multi-device-same-operator awareness to keep in sync. The existing 14-event union needs no
additions for anything built through Part 9. See §17 for the full "why" per event and how this was
checked, not just asserted.

## 5. Error codes

The full list (`ErrorCode` in Appendix A). HTTP status per code is §2a, and which endpoint returns which
is §2b–§2d.

| `code` | Meaning | Returned by |
|---|---|---|
| `NOT_FOUND` | The id in the request doesn't exist (or, for a record, the incident isn't closed) | most commands, `getRecord`, `selectDesk` |
| `INVALID_STATE` | The command doesn't apply to the target in its current state | `openIncident` (alert `closed`, §15a), `holdAlert` (not `new`), `resumeLadder` (not halted), `confirmDispatch` (complete), `addNote` (empty), `acknowledgeEscalation` (focused), `requestDeskPage` (already paged), `selectDesk` (no verified code), `lock` (no session) |
| `LANE_LIMIT` | Three lanes already open | `openIncident`, `raiseIncident` |
| `MIC_BUSY` | Mic held by another lane; retry with `force` | `bindMic` |
| `MEMO_TOO_SHORT` | Closing memo under 40 characters after trimming | `closeIncident` |
| `INVALID_CODE` | Wrong sign-in code | `verifyCode` |
| `CODE_EXPIRED` | Sign-in code past its 10 minutes | `verifyCode` |
| `EMAIL_LOCKED` | 3 wrong codes, email locked for 15 min | `requestCode`, `verifyCode` |
| `RATE_LIMITED` | 5 codes for this email in the last hour | `requestCode` |
| `RESEND_TOO_SOON` | Under 30 s since the last code | `requestCode` |
| `UNAUTHENTICATED` *(proposed)* | No session | every session-gated endpoint (§2e) |
| `BAD_REQUEST` *(proposed)* | Body missing or malformed | any endpoint (§2e) |

The last two aren't in the type yet: nothing in the mock can produce them. They arrive with the HTTP
client, the first code that can.

The three "anticipated" codes this section used to list are resolved, none of them needed:

- **`OFFLINE`**: refusing commands while the connection is down happens in the client, before any
  request is made (`NocStore.refuseIfOffline`). A request that can't reach the server can't receive an
  error code from it either.
- **`ACCOUNT_LOCKED`** (5 failed password sign-ins): superseded by `EMAIL_LOCKED` when the password step
  became an email code (Part 8). Lock after 3 wrong codes, not 5.
- **`SESSION_LOCKED`**: the lock screen is client-only and nothing pauses server-side while locked
  (§2b), so the server never refuses a command because the screen is locked.

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

~~Auth model (OTP flow still to arrive from Yassine), the `LaneState` machine (`free`/`focused`/
`peripheral`/`escalated`/`closing`/`handoff-requested`/`closed`), and take-next/raise-incident command
shapes. Blocked on the Lane Workspace / camera-wall Figma call, not on anything in this document.~~
**Resolved**: the Figma call isn't happening (`DECISIONS.md`'s 5 Oct note) and Yassine unblocked
everything explicitly on 3 Nov. Auth built as Part 8 (6 Nov) — see `DECISIONS.md`'s Part 8 decisions
table and `V2-BUILD-PLAN.md`'s Part 8 notes. `LaneState` and take-next/raise-incident are resolved as
v2 Part 10 (10 Nov, this document) — §15–§17 below. The proposed `'escalated'`/`'closing'`/
`'handoff-requested'` values turned out not to match what actually got built; §15 explains why for each.
See `DECISIONS.md` for the full status of every item from the sign-off memo.

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

**15 Oct — v2 Part 7, camera view without an incident (CameraWorkspace):**
- `src/api/client.ts` / `src/api/mock/MockNocClient.ts`: new `raiseIncident(cameraId, priority)` —
  synthesizes an `Alert` with no AI origin (`severity`/`insidePropertyLine` chosen so `derivePriority`
  resolves to exactly the requested tier; P4 needs severity 3 + outside-the-line, the only combination
  that reaches it since severity tops out at 3) and hands off to the existing `openIncident` entirely,
  so lane-limit, focus and ledger/transcript seeding all come from the one place that already owns them.
  Alert ids use an `ra` prefix (seed alerts already own `a1`-`a6`).
- `src/store/store.ts`: `UiState.viewingCameraId` / `cameraViewReturnTo`; `openCameraView` (first call
  remembers the focused lane and calls `setFocus(null)` — breaks attention for every lane, STATES.md
  §2 — later calls just swap which camera), `closeCameraView` (restores the remembered lane if it's
  still open), `raiseIncident` wrapper (clears camera-view state on success).
- `src/components/CameraWorkspace.tsx` (new): camera + site-camera strip + Raise incident (P1-P4,
  disabled with a hint once lanes are full). Deliberately does not include speech/deterrents/notes
  before raising — see `V2-BUILD-PLAN.md`'s Part 7 notes for why that's a flagged scope cut, not a gap.
- `src/components/Lanes.tsx`: checks `ui.viewingCameraId` before the lane-fallback logic, so
  CameraWorkspace renders even with zero lanes open (the common case, not an edge case).
- `src/components/CameraWall.tsx`: an unowned tile now calls `openCameraView` instead of the Part 4
  placeholder toast.

Verified live: opening an unowned wall tile opens CameraWorkspace and closes the wall; the site-camera
strip switches cameras without re-touching focus; raising at each of the four priorities produced an
alert whose `derivePriority` matched exactly; the raised lane integrated cleanly with every earlier part
(ladder armed with the usual timing, Confirm Dispatch available and undimmed at P1, CommsDock/StatusBar
both correct) with no adjustments needed; Esc restored the previously-focused lane; the Raise button
correctly disabled with a hint once three lanes were open. No real bugs found.

Typecheck clean, 43/43 tests passing (6 new: camera view clears focus, switching cameras doesn't
re-touch it, Esc restores the previous lane, closing with nothing to return to doesn't crash, each
priority raises exactly, and the lane-limit refusal).

**16 Oct — v2 Part 7, Shift report (ShiftReportModal):**
- `src/api/types.ts`: new `ClosedIncidentSummary` (incidentId, siteId, alertTitle, severity,
  insidePropertyLine, openedAt, closedAt, attendedSec, totalSec, memo, nextSteps) and
  `Snapshot.closedThisShift: ClosedIncidentSummary[]`. `incident.closed`'s ServerEvent payload gained a
  `summary` field so the client-side reducer can replay it from buffered events like everything else.
- `src/api/mock/MockNocClient.ts#closeIncident`: builds the summary right before discarding the incident,
  prepends it to `closedThisShift`, includes it on the emitted event.
- `src/store/reducer.ts`: `incident.closed` now also prepends `e.summary` to `closedThisShift`.
- `src/store/selectors.ts`: new `shiftReportKpis` (closed count, averages computed over that count, not
  a running mean — `ShiftStats`' totals divided fresh each time) and `closedByHour` (buckets by hour
  read straight off the ISO string, not `Date#getHours()` — see the timezone bug note in
  `V2-BUILD-PLAN.md`'s Part 7 notes).
- `src/components/ShiftReportModal.tsx` (new): KPIs + hour histogram fixed, only `.sr-table-wrap`
  scrolls. Copy summary writes a plain-text recap to the clipboard, toasts on success/failure.
- `src/components/TopBar.tsx`: new "Shift report" button next to "Keyboard shortcuts".
- `src/store/store.ts`: `UiState.shiftReportOpen` + `setShiftReportOpen`.

Verified live: KPIs and the empty-state message correct with nothing closed; closing an incident updates
the KPI row, adds the correct table row, lights the matching hour on the histogram; Copy summary writes
to the clipboard and confirms with a toast; Esc closes the modal.

Typecheck clean, 47/47 tests passing (4 new: ClosedIncidentSummary recorded newest-first on close, KPI
averages over the closed count, hour bucketing, and the modal's open/close toggle).

**16 Oct — v2 Part 7, Settings (theme + typeface):**
- `src/domain/appearance.ts` (new): `getStoredTheme`/`getStoredTypeface`/`setTheme`/`setTypeface`/
  `applyStoredAppearance`. Applies `data-theme`/`data-typeface` on `<html>`, persists under the v2
  prototype's own `localStorage` keys (`sentry.theme.v2`, `sentry.face`, UI-SPEC.md §7). Every function
  feature-detects `localStorage`/`document` before touching them — `store.ts` reads it at module-eval
  time to seed `UiState`, and the domain/store unit tests run in a plain Node environment on purpose
  (`vite.config.ts`); without the guards, just importing `store.ts` crashed the whole suite, caught and
  fixed before it reached a browser. `src/domain/appearance.test.ts` is regression coverage for exactly
  that failure mode.
- `src/styles/tokens.css`: `:root[data-theme="light"]` and two `:root[data-typeface]` blocks. Light
  values sourced from `docs-v2/tokens/cortai-noc-v2-tokens.css` — Oleg's real, complete light theme on
  his own primitive scale — each mapped onto this project's existing flat token names (noted inline per
  value) rather than adopting his more granular architecture wholesale.
- `index.html`: Google Fonts link for Inter, JetBrains Mono, Atkinson Hyperlegible Next/Mono, alongside
  the existing IBM Plex link.
- `src/hooks/useRovingRadiogroup.ts` (new): WAI-ARIA radio-pattern arrow-key navigation (moves selection
  and real DOM focus together). Used by Settings' two radiogroups specifically — three other existing
  radiogroups (Queue's priority filter, CameraWall's status filter, CameraWorkspace's raise-priority
  selector) stay click-only for now, a separate accessibility cleanup, not folded into this part.
- `src/components/SettingsModal.tsx` (new), `src/components/TopBar.tsx`: new "Settings" button.
- `src/store/store.ts`: `UiState.theme`/`typeface`/`settingsOpen`; `setTheme`/`setTypeface` call into
  `appearance.ts` and patch UI state together, so the Settings radiogroups have something reactive to
  render as checked (applying the DOM attribute itself isn't React state).
- `src/main.tsx`: calls `applyStoredAppearance()` before `createRoot(...).render(...)`, so there's no
  flash of the wrong theme/typeface while React spins up.

Verified live: default state has no `data-theme` attribute (dark, matching the CSS default); switching
to Light repaints the whole app and matches the new tokens exactly (checked computed `body` background/
color); arrow-key roving focus moves both the typeface selection and real DOM focus together; the
computed `font-family` reflects each selection; both settings persist under their exact keys and are
restored correctly on reload with no flash. Screenshot-checked the light theme across every region of
the app — legible throughout.

Typecheck clean, 49/49 tests passing (2 new: appearance.ts's Node-safe fallbacks).

**16 Oct — v2 Part 7, Command palette (Ctrl/⌘+K):**
- `src/hooks/useHotkeys.ts`: Ctrl/⌘+K handled before the broad modifier-key early-return and before
  `isTypingTarget`, so it works from inside a text field (unlike every other global hotkey). Always
  calls `preventDefault()` to stop the browser's own address-bar-search binding; only actually toggles
  the palette when no genuinely blocking flow (closeout, report, mic confirm) is active.
- `src/components/CommandPalette.tsx` (new): builds command groups (Lanes, Focused lane, Queue,
  Navigation) from live server state each render — no new domain/store logic, it's read-only over what
  already exists. "Confirm dispatch" is the one command marked `destructive`; first Enter arms it
  (second Enter required), calling `store.confirmDispatch` directly rather than through
  `LaneWorkspace`'s own on-screen dialog, since the palette is a second entry point that dialog's local
  state can't reach.
- `src/store/store.ts`: `UiState.paletteOpen` + `setPaletteOpen`.
- `src/components/ShortcutsLegend.tsx`: new "Ctrl/⌘ + K" entry.
- No new `NocClient` methods — every command calls an existing store method.

Verified live: Ctrl+K opens with focus in the input; command groups are conditional and correct (no
Lanes/Focused-lane group with nothing open, both appear once a lane exists); query filtering; Enter runs
a non-destructive command and closes the palette; Confirm Dispatch's double-Enter gate holds the ladder
untouched after the first Enter, fires only on the second; Ctrl+K opens correctly from inside a focused
text input without losing its draft; the underlying lane's state was unaffected by the palette opening
and closing around it.

Typecheck clean, 49/49 tests passing (no new tests this part — the command-building and keyboard-nav
logic live entirely in the component, same precedent as the queue/wall filters in Parts 3-4; verified
live instead).

**20 Oct — v2 Part 7, Help (F1):**
- `public/help/help.json` (new, ~80KB): converted verbatim from `docs-v2/prototype/help/help.js` via a
  one-off Node script (`window` stub + `eval` + `JSON.stringify`) — 41 articles, 7 TOC sections, 27
  figures, 4 diagrams. `public/help/img/*.webp` (new, 27 files, ~824KB): the real screenshots, copied
  as-is. Both ship as static assets per `docs-v2/docs/HELP.md`'s "loading contract for the React build."
- `src/domain/help.ts` (new): `HelpContent`/`HelpArticle`/`HelpFigure`/`HelpDiagram`/`HelpTocSection`
  types matching the JSON exactly (figure spots stay 5-element tuples, not objects). `searchHelp`:
  "all terms must match," weighted title(×6)/keywords(×4)/summary(×2)/body(×1), per HELP.md.
  `helpContext(ctx)`: STATES.md §10's priority order, taking plain booleans/ids rather than `UiState` —
  `domain/` stays below `store/` in this project's layering, so the caller (the modal) assembles the
  primitives from `ui`/`server`. `flatArticleOrder`/`prevNextArticle` for tree-order navigation.
- `src/domain/helpRender.tsx` (new): hand-rolled renderer for help.js's documented Markdown subset
  (headings → "On this page" entries, paragraphs, bold/italic, `- `/`1. ` lists, `| |` tables, 5 callout
  types, `{{fig:id}}`/`{{diagram:id}}`, `[[Key+Key]]`, `[text](#id|url)`, and 5 inline UI tokens —
  `{{lane:A}}`/`{{prio:P1}}`/`{{dot:live}}`/`{{badge:kind|label}}`/`{{icon:…}}`, the last never actually
  used in the real content but supported defensively). Builds React elements directly; the one
  `dangerouslySetInnerHTML` use is the diagrams' own inline SVG, justified inline as static
  developer-authored content, not live input.
- `src/hooks/useHelpContent.ts` (new): module-level cache + in-flight promise, fetched once per page
  load regardless of how many times Help opens/closes; `enabled` gates the fetch to only fire once Help
  is actually opened. Loading/ready/error states per HELP.md ("skeleton... 'Help could not load' + Try
  again... the console never depends on it").
- `src/components/HelpModal.tsx` (new): search (`/` focuses it, Enter opens the top hit), contents tree
  (click always works; Up/Down roving focus, Right/Left expand/collapse — no Home/End, flagged scope
  cut), one article at a time (breadcrumb, type badge, title that receives focus, summary, "On this
  page" at 3+ H2s, body, Related, Previous/Next in tree order, meta line), figure lightbox (numbered
  hotspot markers + matching legend, Esc closes it before the modal itself).
- `src/hooks/useHotkeys.ts`: F1 handled the same way as Ctrl/⌘+K — works from inside a text field,
  doesn't stack over a genuinely blocking flow, always `preventDefault()`s.
- `src/store/store.ts`: `UiState.helpOpen` + `setHelpOpen`.
- `src/components/TopBar.tsx`: new "Help" button. `src/components/CommandPalette.tsx`: one "Help"
  command (not all 41 articles — flagged simplification); renamed the old `help` command id to
  `shortcuts` to free it up.
- `src/styles/layout.css`: full `.help-*` rule set, including a `--c-*` alias block scoped to
  `.help-diagram` mapping the 18 CSS variable names the real diagrams' SVG markup references (a third
  naming scheme, distinct from both this project's tokens and Oleg's Settings-era `--color-*` ones) onto
  this project's existing tokens, so the unmodified SVGs render correctly in this app's theme.

Verified live: F1's context-sensitivity held across every state checked (no lanes → `console-overview`;
a lane open → `lane-workspace`; a lane escalated ≥45s → `escalation`), matching STATES.md §10's priority
order in practice. Tree click-navigation; search's all-terms-must-match and Enter-opens-top-hit; a real
diagram rendering in this app's theme (computed SVG text color matched this project's actual `--text-2`,
not a missing-variable fallback); a table and a numbered-steps list from real content; Related links;
Previous/Next; the meta line. The figure lightbox's hotspot count matched its legend count exactly (12
and 12 on the article checked); Esc closed the lightbox first, the whole modal on the second press.

Typecheck clean, 58/58 tests passing (9 new, covering `flatArticleOrder`/`prevNextArticle`, `searchHelp`'s
weighting and all-terms-must-match behavior, and `helpContext`'s priority order against a small fixture
— not the full 80KB real content, kept fast and focused).

**9 Nov — v2 Part 9 (1/N), every close seals a Record:**
Per the Part 9 decision note in `DECISIONS.md` (9 Nov): closing an incident no longer produces a report
conditionally on a 'report' next-step checkbox — it always seals a Record. `ReportModal` is gone,
replaced by `RecordModal`.
- `src/api/types.ts`: `NextStepId` drops `'report'` (there's nothing left to opt into — sealing is
  unconditional, and nothing else keyed off that id). `ClosedIncidentSummary` gains `operator: Operator`
  — needed for History's (Part 9, next) operator filter; `ShiftReportModal` doesn't need it, one operator
  per shift there. `IncidentReport` gains `transcript: TranscriptLine[]` (this incident's lines only) —
  the data existed on `Snapshot.transcript` already, just never surfaced through this bundle.
- `src/api/mock/MockNocClient.ts#closeIncident`: `ClosedIncidentSummary.operator` set from
  `this.snap.shift.operator`. `#buildReport`: `transcript` filtered the same way `ledger`/`evidence`
  already were.
- `src/store/store.ts`: `UiState.report` → `UiState.record` (and `closeReport` → `closeRecord`);
  `submitCloseout` sets it unconditionally instead of gating on `nextSteps.includes('report')`.
- `src/components/CloseoutModal.tsx`: dropped the "Create incident report" checkbox (STEPS list), since
  there's no longer a choice to make there; default `steps` is now `[]`, not `['report']`.
- `src/components/RecordModal.tsx` (new, replaces `ReportModal.tsx`): same underlying data, reorganized
  into 5 tabs matching the `incident-records` help article's table exactly — Evidence (stills + subject
  description), Timeline (full ledger, reusing `domain/rules.ts#ledgerKindLabel` and the `.ledger`/`.led`
  styling `LaneWorkspace` already has), Transcript (same `.ledger`/`.tline` styling), Notes (closing
  memo, in-incident notes, next steps queued), Operator (who/when + the old "system response" summary —
  ladder stages, siren/strobe, two-way). No SHA-256 hash and no "viewed by" log per the decision note
  (nothing real to hash; single operator, nothing to log). Added "Copy link" (copies a `/records/:id`
  URL — no backend to resolve it yet, matches the pattern `ShiftReportModal`'s "Copy summary" already
  uses for clipboard + toast). Export PDF intentionally not built (out of scope per Yassine, 3 Nov).
- `src/hooks/useHotkeys.ts`: the 3 `ui.report` blocking-flow checks renamed to `ui.record`.
- `src/styles/layout.css`: `.report-body` → `.record-body`; `.modal.report` (680px width) →
  `.modal.record`; dropped the now-pointless `report` class from `ShiftReportModal`'s own modal (it
  already carries `.shift-report`, which alone already set its real 760px width — `report` there did
  nothing but apply then immediately get overridden by source order).

Verified live: closing an incident with the next-steps panel left entirely untouched (zero next steps
ticked) still opens a Record immediately — the behavior this whole change is for. All 5 tabs render
real content for a freshly-closed incident (Evidence showed the subject description; Timeline showed
the full event list including "Incident opened" and the closing-memo line; Transcript showed the AI
callout and system lines; Notes showed the memo; Operator showed the operator, duration and ladder
summary). Copy link produced the "Record link copied" toast. Escape and the ✕ both close it.

Typecheck clean, 70/70 tests passing (no new tests this step — pure rename/reorg of existing, already-
covered data; `store.test.ts`'s two closeout tests updated to pass `[]` instead of `['report']` and to
read `ui.record`).

**10 Nov — v2 Part 9 (2/3), History list:**
- `src/api/client.ts`: new `NocClient.getRecord(incidentId): Promise<Result<IncidentReport>>` —
  re-opens an already-sealed Record. Deliberately a lookup, not a rebuild: the live `Incident` behind a
  closed incident (ladder state, siren/strobe, visit count) is gone from `Snapshot.incidents` by the
  time History would need it back.
- `src/api/mock/MockNocClient.ts`: new `private records = new Map<string, IncidentReport>()`, populated
  in `closeIncident` right after `buildReport` runs (same object `submitCloseout` already uses, not a
  second derivation of it — that's also a more literal reading of "immutable" than recomputing would be).
  `getRecord` reads it back, `NOT_FOUND` if the id was never closed.
- `src/store/store.ts`: `UiState.historyOpen` + `setHistoryOpen`. New `openRecord(incidentId)`: calls
  `client.getRecord`, sets `ui.record` on success, toasts a warning otherwise (same pattern as `addNote`).
- `src/components/HistoryModal.tsx` (new): filters — **date, site, priority, operator** (Yassine's own
  list; not `COMPONENTS.md`'s older All/P1–P2/Referred, which needs an outcome field `CloseoutModal`
  doesn't collect) — plus free-text search over site name and alert title. Columns: Closed, Site,
  Priority, Title, Duration, Operator. Sorted newest-first (`closedThisShift`'s existing order). Scoped
  to `server.closedThisShift` only — this session, not a fabricated multi-day store. Filters/search are
  local component state; only the open/closed flag (`historyOpen`) lives in the store, since `TopBar`
  and `CommandPalette` both need to trigger it. Rows are clickable (`store.openRecord`), opening
  `RecordModal` on top of `HistoryModal` rather than replacing it — both are independent
  `modal-backdrop`s, so this fell out of `App.tsx`'s mount order (History before Record) for free.
  Reuses `ShiftReportModal`'s `.sr-table-wrap`/`.sr-table` CSS rather than a parallel table style — same
  visual spec, just with clickable rows.
- `src/hooks` / modals: guarded `HistoryModal`'s own Escape handler to no-op while `ui.record` is set,
  so a Record stacked on top of History consumes the first Escape press and History only closes on the
  second. Without this, both windows share a `window`-level `keydown` listener and a single Escape would
  have closed both at once.
- Entry points: `TopBar`'s pills row ("History", next to "Shift report") and `CommandPalette`'s
  Navigation group.
- `src/styles/layout.css`: `.modal.history`, `.hist-filters`, `.hist-row`, `.hist-count`.
- `src/components/RecordModal.tsx`: fixed "Copy link"'s toast text from "Record link copied" to "Link
  copied" to match the decision note's wording exactly (`COPY.md`'s existing toast copy) — a wording
  slip in the previous commit, caught while cross-checking this one against the decision note.

Verified live: empty History (nothing closed) shows "No closed incidents yet…"; closed two incidents,
reopened History via the command palette — both listed newest-first with a correct count line; a
nonsense search produced the exact "No match for '…'" copy; a non-matching priority filter produced 0
rows and the filter-only empty copy, reverting it brought the row back; clicking a row opened its Record
on top, and the Escape-stacking fix verified exactly as intended (first press closes Record only, second
closes History). No console errors beyond the same unrelated favicon 404 noted in Part 8.

Typecheck clean, 73/73 tests passing (3 new: a sealed Record carries its operator and `openRecord`
re-opens the identical cached data rather than rebuilding it; `openRecord` on a never-closed incident
toasts instead of touching `ui.record`; `setHistoryOpen` toggles the flag).

Not done yet: the `incident-records` help article (same treatment Part 8 gave its 4 articles) — next.

**10 Nov — v2 Part 9 (3/3), incident-records help article + F1 routing — Part 9 complete:**
- `src/domain/help.ts`: `helpContext()` gained `historyOpen`, same tier as `shiftReportOpen`/
  `settingsOpen` (not a blocking flow — `ui.record` already blocks F1 outright, same as
  `closingIncidentId`/`micConfirm`). Routes to `incident-records`.
- `src/components/HelpModal.tsx`: passes `ui.historyOpen` through.
- `public/help/help.json`: `incident-records` rewritten to match this build — TopBar/command-palette
  entry points (not a left-panel tab + `/`); Yassine's own date/site/priority/operator filters (not
  All/P1–P2/Referred); no SHA-256 hash or video clip (nothing real to hash or play); flat newest-first
  list scoped to this shift only (not hour-grouped with a 7-day search reach); no "viewed by" log; no
  Export PDF; no supervisor addendum. Both figure references dropped after visual inspection — both
  screenshots show the old design closely enough to actively mislead (filter chips reading "All 4 /
  P1–P2 2 / Referred 1", a visible Export PDF button and the SHA-256 hash line), not just stale chrome.
  Kept the image files and `figures` dict entries in place, same as Part 8.
- `src/components/HistoryModal.tsx`: the Escape-stacking guard from the previous commit (don't steal
  Escape from a Record on top) now also checks `ui.helpOpen` — F1 routing to `incident-records` made
  "Help open on top of History" newly reachable, and a single Escape press was closing both at once
  before this fix. Same bug class as the Record case, caught live rather than by a failing test.

Verified live: F1 with History open opens the rewritten article (no "P1–P2" text anywhere in the
rendered body); searching the new filter terms surfaces it as the top hit; Escape closes Help first,
History stays open underneath. No console errors beyond the same unrelated favicon 404.

Typecheck clean, 74/74 tests passing (1 new: `historyOpen` routes to `incident-records`, loses to
`settingsOpen` when both are true, same priority-order pattern every other `helpContext` case already
tests).

**Part 9 is complete** — all 5 points of the 9 Nov decision note are built.

## 15. `LaneState` — the real transition model (v2 Part 10)

§12's old proposal (`free`/`focused`/`peripheral`/`escalated`/`closing`/`handoff-requested`/`closed`) was
written against `STATES.md` alone, before the interaction model existed to check it against. Parts 1–9
are built now, so this is grounded in what the code actually does (`Incident`/`LadderState` in
`types.ts`, `MockNocClient`'s `openIncident`/`setFocus`/`closeIncident`), not a re-read of the spec.

**There is no single `LaneState` field anywhere in the code.** A lane's state is a derived read of
`Incident` + whether it's in `Snapshot.incidents` at all — the same way the UI itself treats it (no
component switches on a `state` string; they each read the specific fields they need). The useful
`LaneState` for a real backend's own bookkeeping is narrower than the old proposal:

| State | Meaning | Entered by |
|---|---|---|
| `free` | No incident in this lane slot (0–3 lanes can be `free` at once, `MAX_LANES = 3`) | Initial; or `closed` (below) |
| `focused` | Incident open, `Snapshot.focusIncidentId === id` | `openIncident`/`raiseIncident` when no lane is currently focused; or `setFocus(id)` from `peripheral` |
| `peripheral` | Incident open, not focused | `openIncident`/`raiseIncident` when another lane already holds focus; or `setFocus` moving focus away (to another lane, or to `null` for camera view) |
| `closed` | Removed from `Snapshot.incidents`, sealed into `ClosedIncidentSummary`/`Record` (Part 9) | `closeIncident`, unconditionally |

Transitions: `free →[open/raise]→ focused` (first/only open lane) or `free →[open/raise]→ peripheral`
(a lane's already focused); `peripheral ⇄[setFocus]⇄ focused` (A/B/C, a lane-card click, mic-confirm
moving focus); `focused|peripheral →[close]→ closed →[implicitly]→ free` (closing always frees the lane
slot — nothing else can reopen it, `closeIncident` doesn't recycle `laneIndex`, the next `openIncident`
picks whichever index is unused). `closed` has no further transitions — Part 9's "fully immutable" already
covers that.

**Why the other three proposed values don't appear:**

- **`'escalated'`** isn't a competing state, it's an *attribute of `peripheral`* — `attentionLevel`/
  `escalationTier` (`domain/rules.ts`) are pure functions of `now - unattendedSince`, and
  `unattendedSince` is `null` *by construction* while `focusedSince` is set (`setFocus` clears one and
  sets the other, atomically, every time). A focused lane literally cannot be escalated — not a rule
  enforced by a guard, a consequence of the two fields being mutually exclusive. Thresholds, for
  reference: notice 30s / warning 45s / alarm 60s (`UNATTENDED_NOTICE_SEC`/`_WARNING_SEC`/`_ALARM_SEC`,
  `domain/constants.ts`) — `watching` below notice, `unattended` between notice and warning, `escalating`
  at warning+ (`attentionLevel`); the `EscalationBar`'s own `none`/`warning`/`critical` is the same clock
  read at a different cut (`escalationTier`). `escalationAcked` (K) doesn't change the tier or stop the
  clock, only quiets the banner for the current streak — a fresh unattended streak (next time the lane
  loses focus) needs acking again, it doesn't carry over (`setFocus`'s own comment: "last streak's ack
  doesn't carry over").
- **`'closing'`** isn't server-tracked at all. `CloseoutModal` being open is pure client-local UI state
  (`ui.closingIncidentId`) — the server never sees an intermediate "closing" state, only the one atomic
  `closeIncident` call once the operator submits. A real backend needs no state for this; if the operator
  abandons the closeout dialog, nothing happened server-side to undo.
- **`'handoff-requested'`** doesn't exist and can't yet — it would need a second operator identity to
  hand off *to*. This build has exactly one operator role and no multi-operator awareness (`DECISIONS.md`
  #6, deferred to integration). Not to be confused with the already-built mic hand-off (`bindMic`,
  `MicConfirmDialog`) — that's one operator moving their own mic between their own lanes, a `focused`/
  `peripheral` transition under a different name, not an operator-to-operator concept.

### 15a. `AlertState` alongside the lane (decided, Yassine 23 Nov)

Part 10 flagged that `AlertState.closed` was typed but never assigned: `closeIncident` set the alert back
to `'held'`. That was a real bug, not a cosmetic one: the closed alert sat in the Held tab next to
genuinely parked ones, and clicking it opened a fresh lane with the ladder armed, so talk-down and then
siren would fire on an incident already closed. Fixed; the alert's lifecycle is now:

| From | Command | To | Notes |
|---|---|---|---|
| `new` | `openIncident` | `working` | Lane opens (`free → focused`/`peripheral` above) |
| `new` | `holdAlert` | `held` | Any other source state → `INVALID_STATE` |
| `held` | `openIncident` | `working` | Held alerts can still be taken |
| `working` | `closeIncident` | `closed` | Same call that moves the lane to `closed` |
| `closed` | `openIncident` | — | **Refused, `INVALID_STATE`.** Terminal state, no transitions out |

- **A closed alert leaves the queue entirely.** No tab, no count: the queue's tabs are `new`/`working`/
  `held` only (`Queue.tsx`, `alertCounts`). It shows only in History, via `ClosedIncidentSummary`/
  `Record` (Part 9).
- **The state check runs before the lane limit.** A closed alert is refused for what it is, never with
  `LANE_LIMIT` just because three lanes happen to be open.
- **Interaction with idempotency (§6).** A *retried* take carrying the original `Idempotency-Key` gets
  the original response replayed, even if that incident has since closed. Replay is "what did my request
  do", not "do it again". Any take with a *new* key on a closed alert is `INVALID_STATE`.
- The `alert.upsert` event carrying `state: 'closed'` is emitted on close, before `incident.closed`. No
  new event type is needed (§17's list is unchanged).
- Code: `MockNocClient.closeIncident`/`openIncident`; tests in `src/store/store.test.ts`
  ("closed alerts").

## 16. Take next / Raise incident — command shapes (v2 Part 10)

**Take next resolves to no new command.** There's no server-side "give me the next alert" endpoint,
because there's no server-side concept of "next" to give — the queue's sort order (§1a) is a client-side
read of already-synced data, and the operator picks a specific row to click. That's `openIncident(alertId)`,
already in §2d. A backend implementer reading "take next" in the brief should build nothing new for
it; the queue sort formula (§1a) *is* the feature, `openIncident` is the only command it needs.

**Raise incident** (`NocClient.raiseIncident`, built Part 7 for `CameraWorkspace` — a camera with no AI
alert behind it) is a real command, already typed, newly added to §2/§3's tables above:

```
POST /api/incidents/raise
{ "cameraId": "c07", "priority": "P1" | "P2" | "P3" | "P4" }
-> Incident   (same shape openIncident resolves to)
```

The server has no raw `priority` field anywhere (`derivePriority` computes it, always, from
`severity`/`insidePropertyLine` — §1a) — raising manually has to pick a `(severity, insidePropertyLine)`
pair that round-trips back through `derivePriority` to exactly the tier the operator chose, not a second,
parallel priority representation. `MockNocClient.raiseIncident`'s mapping, reproduced here because it's
the one genuinely non-obvious part of this command:

| Chosen priority | `severity` | `insidePropertyLine` | Check: `derivePriority(severity, insidePropertyLine)` |
|---|---|---|---|
| P1 | 1 | `true` | 1 + 0 = **P1** |
| P2 | 2 | `true` | 2 + 0 = **P2** |
| P3 | 3 | `true` | 3 + 0 = **P3** |
| P4 | 3 | `false` | 3 + 1, floored at 4 = **P4** |

P4 is the one non-obvious row: `severity` tops out at 3 (the AI's raw classification only ever has 3
tiers), so P4 is only reachable by pairing the highest severity with "outside the line," never by a 4th
severity value that doesn't exist. A synthetic `Alert` is created first (`riskFactors: [{ label:
'Raised by operator, no AI alert', weight: 'high' }]`, `confidence: null` — there's no AI confidence to
report), then the existing open flow runs unchanged: lane-limit check, lane assignment, auto-focus if
nothing else is focused, ledger/transcript seeding — all of it already correct for a normal alert-driven
open, reused rather than duplicated. Emits `alert.upsert` for the synthetic alert, then whatever
`openIncident` itself already emits (`incident.upsert`, possibly `focus.changed`) — no new event type.

## 17. `ServerEvent` list for the real socket — confirmed complete through Part 9 (v2 Part 10)

The full list, unchanged since phase 1, is still the whole list a real WebSocket needs to emit:

```
alert.upsert · incident.upsert · incident.closed · ladder.updated · ledger.added · evidence.added
transcript.added · camera.updated · watch.updated · focus.changed · mic.changed · speaker.changed
desk.paged · desk.page.acknowledged
```

§4 flagged 5 candidate additions as "anticipated" without building anything to check them against. Now
that there's a real implementation to check, each one resolves to "not needed," for a specific reason —
the point of this section is to show the check, not just assert the conclusion:

1. **`lane.escalated`** — escalation tier (`watching`/`unattended`/`escalating`, or the `EscalationBar`'s
   `none`/`warning`/`critical`) is a pure function of elapsed time since `unattendedSince`, computed
   fresh on the client every render tick (`attentionLevel`/`escalationTier`, `domain/rules.ts`). The
   server doesn't need to tell the client when a threshold crosses — the client already has the one
   timestamp it needs, from the `incident.upsert` that already fires whenever `unattendedSince` changes
   (every focus change, by construction — §15). A dedicated event would just be the server doing the
   client's own arithmetic redundantly, and would need to be perfectly re-derivable from the same
   timestamp anyway or the two could disagree.
2. **`lane.acknowledged`** — `acknowledgeEscalation` already emits `incident.upsert` with the updated
   `escalationAcked` (§2d). A second,
   parallel event for the same field change has no reader that `incident.upsert` doesn't already serve.
3. **`video.signal.changed`** — resolved in `camera.updated`'s favor, the option §4 already named but
   left as "worth deciding." `Camera.signal`/`latencyMs` are plain fields on `Camera` (§7); nothing
   about them needs a separate event stream from the rest of `Camera`'s own updates.
4. **`connection.changed`** — doesn't fit the event model at all: a connection event can only arrive
   *over* the connection, so the one state transition that most needs announcing (going offline) is
   exactly the one a `ServerEvent` can never deliver. §10 already correctly frames this as a transport
   concern ("the heartbeat timeout that actually triggers the `offline` state") — a real client detects
   this itself, from the WebSocket's own `close`/error, or a missed heartbeat, never from a payload. The
   reverse direction (coming back online) *could* be a normal event once reconnected, but by then the
   client already knows it reconnected from the socket itself succeeding — redundant again.
5. **`session.changed`** — Part 8 built the entire auth flow as request/response
   (`requestCode`/`verifyCode`/`selectDesk`/`lock`/`signOut`, each resolving its own `Result`), with
   nothing else that needs to learn about a session change it didn't cause itself. This would only earn
   its keep with multi-device-same-operator awareness (one desk learning another signed the same
   operator out) — not built, not scoped (`DECISIONS.md` #6, same single-operator boundary as hand-off).

No additions needed for anything through Part 9. This isn't a claim that the event union is frozen
forever — hand-off (§3) or multi-desk paging, if either gets scoped in later, would each plausibly need
a real new event (an operator needs to *learn* a hand-off was requested, which is exactly the kind of
fact `ServerEvent` exists for) — just that nothing currently built or currently scoped needs one.

---

**10 Nov — v2 Part 10, `LaneState` + take-next/raise-incident + `ServerEvent` reconciliation (docs only,
no code):** Resolved all three items §12 had listed as blocked since 2 Oct, now that Parts 1–9 give
something real to check them against instead of just `STATES.md`. New: §15 (`LaneState`, grounded in
`Incident`/`LadderState`, explains why `'escalated'`/`'closing'`/`'handoff-requested'` don't map onto
what got built), §16 (take next resolves to no new command; `raiseIncident`'s already-built shape,
including the non-obvious P4 severity/insidePropertyLine mapping), §17 (the existing 14-event
`ServerEvent` union confirmed sufficient through Part 9, each of §4's 5 candidate additions resolved
with a specific reason, not left as "anticipated" indefinitely). Also corrected drift caught along the
way, same document, while it was already open: §3's "anticipated" command list was stale — `raiseIncident`
(Part 7), `acknowledgeEscalation` (Part 2) and `confirmDispatch` (Part 6) were already built and simply
never got moved into the main table; `resumeLadder` was missing from the table entirely. §2's REST sketch
gained the endpoints those three plus `raise` and `ladder/resume` need. `DECISIONS.md`'s Auth row
corrected from "Documented… Blocked" to "Done" (Part 8, 6 Nov) — it had been stale since that part shipped.
One loose end flagged, not fixed (out of scope for a docs-only point): `AlertState.closed` is never
actually assigned (§15) — a product call, not an engineering one.

No code changed — nothing to typecheck or test beyond what Parts 1–9 already verified. This point's own
"done when" is the three things `V2-BUILD-PLAN.md`'s Part 10 row asks for, all now written and grounded
in the real implementation rather than speculative.

**23 Nov — closed alert state (Yassine's first post-approval task):** the `AlertState.closed` loose end
§15 flagged on 10 Nov was a real bug, not a product question: a closed alert landed back in Held and
reopened with the ladder armed. Decided and fixed. New §15a gives the alert's full transition table
(`closed` is terminal, refused with `INVALID_STATE`, checked before the lane limit) and how it interacts
with §6's idempotency replay. §3's `openIncident` row and §5's `INVALID_STATE` description point at it.
