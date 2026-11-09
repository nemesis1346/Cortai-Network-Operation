# v2 sign-off: Yassine's decisions (1 Oct)

Response to the [sign-off memo](https://claude.ai/artifact/NExg3jmFhJS6pUpg1x9b2W). Phase 1 itself —
"checked the zip, ran the tests and the app... approved as delivered" — needs no further action.

Status column: **Done** (built and verified live), **Documented** (decided, written down, not yet
built — usually because it needs something from Yassine first, like the Lionston flow), **Deferred**
(decided not to build yet, on purpose), **Blocked** (still needs the Figma call).

## The two blockers

| # | Decision | Status |
|---|---|---|
| Queue sort | Oleg's hybrid: P1–P4 primary (derived from severity × inside-the-line, never hand-set), then watch index, then age. | **Done** — `domain/rules.ts#derivePriority`, `docs/API-CONTRACT.md` §1a |
| Auth | OTP stays. Keep Oleg's card, desk selector, error states, lock screen; swap the password step for OTP. Yassine sending the Lionston flow. | **Documented** — `docs/API-CONTRACT.md` §12. Blocked on the Lionston flow arriving; nothing to build until then. |

## Product decisions (`OPEN-QUESTIONS.md` #3–8)

| # | Decision | Status |
|---|---|---|
| 3 · 4th-lane refusal | Add "Page second desk" as a third button. | **Done** — `Queue.tsx` refusal banner, `NocClient.requestDeskPage` |
| 4 · Held tab | Keep it, add the Hold action. Exists in phase 1; suppressed/auto-logged alerts use it. | **Done** — `NocClient.holdAlert`, "Hold" button on New-tab rows |
| 5 · Report vs. record | Merge into the sealed Record, drop Modal O5 — as long as the record keeps the full report content and the next-steps queue. | **Documented** — decided in full below (Part 9 decision note, 9 Nov), unblocked by Yassine 3 Nov. Not yet built. |
| 6 · Roles | Single operator role for now, keep the siren rule as decided (any operator can fire it without an incident, 600ms hold, logged). Supervisor matrix comes at integration — don't build role UI yet. | **Deferred** — no action needed, matches what phase 1 already does (no role system). |
| 7 · Ladder timings | Per site from the site record, 30/45/60 (the existing default) as fallback. | **Done** — `Site.ladderStages?`, seeded on 3 Tait Street as `[0, 8, 20, 35]` to prove it's live |
| 8 · Retention | 90d/7d are placeholders; Yassine confirming with the client. Not blocking. | **Deferred** — still placeholder-only; Part 9 decision note below confirms this extends to History too, not just the Record view. |

## Deviations from the brief

Approved: almost all of them, **IBM Plex included**. Done — `tokens.css` (`--font-body`/`--font-mono`),
`index.html`'s font link. IBM Plex Sans + Mono replaces Archivo + JetBrains Mono.

**Update, 5 Oct: the Oleg/Yassine call is cancelled.** No formal review gate on the remaining two items.
Marco stays the point of contact with Oleg and will relay anything that comes up as questions arise,
rather than a scheduled sign-off. Building proceeds without waiting on it:
- The single Lane Workspace replacing the current 1/2/2+mini grid.
- The camera wall staying open while incidents are open (vs. the brief's "locked while open").

Both carry slightly more build risk than an explicitly-approved item, since neither got the same
explicit "yes" the rest of the deviations did — Yassine wanted to see them on Figma first, and that
viewing isn't happening in a structured way now. Worth a quick confirmation from Marco before either
ships to real use, not a reason to hold the build.

**Confirmed, 26 Oct:** Yassine used both live during his v2 review and approved them as built — no
Figma pass needed after all. The risk flagged above is closed; nothing left to confirm on either item.

Everything else approved in the deviations table (estate tree replacing the camera ribbon, Comms Dock
replacing the voice strip, the mic hand-off dropping its confirm step for an explicit button, the
1440/1024 breakpoints, the rest of the new token system) is being built now too, in parts — see
`V2-BUILD-PLAN.md` for the breakdown and order.

# v2 full approval and Part 8-10 (Yassine, 3 Nov)

NOC v2 approved in full, including the two previously-at-risk deviations above. Everything remaining —
sign-in/lock/connection-lost (first), Record and History, and the backend contract — is explicitly
unblocked: "you have all you need, no need to wait for anything from me: decide yourself where a point
is open, write the decision in DECISIONS.md, and keep going." Target: ready ~1 Dec. Frontend/mock only,
behind `NocClient`. Rules: deterministic fixtures, no invented numbers, small commits, one PR per point,
Friday updates (done/next/blocked/hours), same-day flag if actually blocked. Out of scope: real video,
real alerts, voice/TTS, report PDF, multi-desk paging, roles.

Breakdown and order in `V2-BUILD-PLAN.md` (Parts 8–10). Decisions made while building, as instructed:

| # | Point | Decision |
|---|---|---|
| T key | Yassine already decided this one himself, just recording it: keep "Take next" as click-a-queue-row only, don't bind T. Mentioned in 8 help articles but was never wired even before this message. No reason found to change it — binding a key to the exact same single action the row click already does would be a second way to do one thing, not a feature. |
| Idle-lock minutes | **15**, per Yassine's "default 15 minutes, a constant in `domain/constants.ts`" — overrides the v1.2 lock-screen help article's stale "10 minutes" (that article predates the OTP rework and the password-era design it describes). `IDLE_LOCK_MIN` in `domain/constants.ts`. |
| Unlock mechanism | No separate unlock endpoint — Yassine's auth method list has none, and "the lock screen asks for a fresh email code" reads as literally re-running `requestCode`/`verifyCode`, same as sign-in, just without a desk re-pick. |
| Expired code vs. wrong code | `000000` (expired) does **not** count toward the 3-wrong-attempts lock — the operator didn't mistype anything, the code just aged out. Only an actually-wrong code increments the counter. Not stated either way in the brief; this is the more defensible reading and is what `MockNocClient.verifyCode` implements (`src/api/mock/auth.test.ts` covers both paths). |
| Node 24/25 test fix | Already done — `125abfb`, 26 Oct, before this message arrived. Nothing further needed for this point. |
| Sign-in/lock/connection-lost help articles | `help.json`'s `sign-in`, `sign-in-problems`, `lock-screen`, `connection-lost` articles are Oleg's verbatim v1.2 copy, written for the password-era design (e.g. "Enter your password", "five failed attempts"). They'll need real content edits once the OTP screens exist — the "import verbatim" rule from Part 7 was about not freely rewriting Oleg's words, not about keeping copy that describes a flow the app no longer has. Edits land with the sign-in build, not before. |

# Part 9 decision note: Record and History (Marco, 9 Nov)

Written before any Part 9 code, per Yassine's own instruction for this point. Grounded in three sources
that mostly agree: `OPEN-QUESTIONS.md` #5/#8 and `DEVIATIONS-FROM-BRIEF.md` #7/#14 (the original brief
vs. v2 gap), `docs-v2/docs/COMPONENTS.md`'s `HistoryItem`/`HistoryGroup`/`HistoryFilters`/`RecordModal`
spec, and `help.json`'s `incident-records`/`close-incident`/`shift-report` articles (Oleg's own, shipped
verbatim since Part 7, already describing this exact feature in detail). Where Yassine's 3 Nov message
gives something more specific than those older sources, his wins — noted inline below.

**1. What the sealed Record contains.** Required (per `DECISIONS.md` #5, already settled): the full
report content and the next-steps queue. Built from data that already exists — `IncidentReport`
(`types.ts`) already bundles `incident`/`alert`/`site`/`watch`/`operator`/`ledger`/`evidence`; the memo
and next-steps live on `CloseIncidentInput`/`ClosedIncidentSummary`. Adding, to match both `COMPONENTS.md`'s
`RecordModal` and the `incident-records` help article (they independently describe the same 5 tabs):
**Evidence** (stills — no real clip/video, out of scope per Yassine's own list; no SHA-256 hash either,
there's no real file to hash against, a `string` field pretending to be one would be an invented number),
**Timeline** (the ledger, already captured), **Transcript** (filtered by `incidentId`, already captured),
**Notes** (the closeout memo + notes filed during the incident, already captured), **Operator** (who
handled it, when — no "viewed by" access log: that only means something once more than one operator
exists, which is `DECISIONS.md` #6's deferred role matrix, not this point's job to build early).
`ClosedIncidentSummary` gains one field it's missing today: `operator` (name/id) — needed for the History
filter Yassine asks for below, and trivial to add since `MockNocClient.closeIncident` already has
`this.snap.shift.operator` in scope when it builds the summary.

**2. When it's sealed, and immutability.** On close, right after the memo/next-steps step — same moment
`close-incident`'s help article already describes ("The incident moves to History as a sealed, read-only
record"), same moment `STATES.md`'s `closing → closed → free` transition already lists "record sealed" as
one of its effects. **Every** closed incident gets a sealed Record — not gated on the `'report'`
next-step checkbox the way `ReportModal` is today (that gate goes away; `'report'` becomes just one of
the optional follow-up flags shown inside the Record, same as `'police'`/`'owner'`/etc., not a condition
on whether a Record exists at all). This is the one real behavior change from current closeout: today,
skip the `report` checkbox and nothing opens; after this, every close produces a Record regardless,
because History has to show every closed incident, not just the ones someone happened to flag. Fully
immutable once sealed — the help article's "a supervisor can add an addendum" exception is cut for now,
same reasoning as `DECISIONS.md` #6: no role system exists yet to make "supervisor" mean anything, and a
half-built addendum feature with no one who can actually use it isn't worth the surface area.

**3. History list.** Yassine's own filter list — **date, site, priority, operator** — is what's built,
not `COMPONENTS.md`'s older `HistoryFilters` (segmented All / P1–P2 / Referred). The two don't reconcile
cleanly: "Referred" needs an outcome classification (Resolved / False alarm / Referred to police) that
exists in Oleg's original close-incident design but was never carried into this build's actual
`CloseoutModal` (next-steps checkboxes only, no outcome field) — adding one now would be scope beyond
what Yassine actually asked for this point, so it's not happening; his filter list is used as given.
Columns: **Closed** (date/time), **Site**, **Priority**, **Title** (the alert), **Duration**, **Operator**
— covers every one of his four filters plus enough context to identify the incident; `Lane`/`Outcome`
from `HistoryItem`'s older spec are left out (lane is a transient slot, not meaningful history; outcome
doesn't exist in this build's data, see above). Sort: newest first (`closedAt` desc) — matches both
`ClosedIncidentSummary`'s existing convention and every design source. Search: a free-text field over
site/title, alongside the four filters, since a filter-only list with no search would be a real step
down from what Oleg's spec and the help copy both promise. Empty states, reusing `COPY.md`'s copy nearly
verbatim: **"No closed incidents yet — Closed incidents land here with their full record."** and **"No
match for '{q}' — try a different site, title or operator."** (adapted from "Search covers site, camera,
type and record number" since this build's search doesn't reach camera/record-number).

Scope, not in either Yassine's ask or the older design docs but load-bearing for what gets built: History
shows incidents **closed this session** — the same underlying data `ShiftReportModal`'s table already
uses (`Snapshot.closedThisShift`), not a separately-persisted, multi-day store. Oleg's spec describes a
shift-scoped list with a 7-day search reaching further back; building real multi-day persistence is
outside "frontend and mock data only," and faking several days of history would mean inventing records
that never happened — exactly what Yassine's "no invented numbers" rule rules out. The 90-day-kept/
7-day-search language from `OPEN-QUESTIONS.md` #8 and the help article stays exactly what `DECISIONS.md`
#8 already says it is: placeholder copy, not logic anything filters against.

**4. Replacing `ReportModal`.** `RecordModal` (new) replaces it outright — `ReportModal.tsx` and its
`ui.report`/`closeReport`/the `nextSteps.includes('report')` gate in `submitCloseout` all get removed
once History/Record exist and are wired to the same data. "Copy link" is built (a real mock action —
copies an identifier, toasts "Link copied" per `COPY.md`'s existing toast copy). "Export PDF" is not —
Yassine's 3 Nov message lists "report PDF generation" explicitly under out-of-scope.

**5. Retention.** No change from `DECISIONS.md` #8: 90d/7d stay placeholder constants/copy, confirmed
(not just by default but deliberately, per the scope note in point 3 above) that no History filtering,
search-window enforcement, or data-expiry logic depends on either number in this build.
