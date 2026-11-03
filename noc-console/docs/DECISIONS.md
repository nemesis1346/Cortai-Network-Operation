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
| 5 · Report vs. record | Merge into the sealed Record, drop Modal O5 — as long as the record keeps the full report content and the next-steps queue. | **Blocked** — the sealed-record/History concept doesn't exist in phase 1 yet and is entangled with the still-open interaction model (History is new-in-v2, not a v1.2 carryover). Not building a half version of it before the Figma call; `ReportModal` stays as-is until then. |
| 6 · Roles | Single operator role for now, keep the siren rule as decided (any operator can fire it without an incident, 600ms hold, logged). Supervisor matrix comes at integration — don't build role UI yet. | **Deferred** — no action needed, matches what phase 1 already does (no role system). |
| 7 · Ladder timings | Per site from the site record, 30/45/60 (the existing default) as fallback. | **Done** — `Site.ladderStages?`, seeded on 3 Tait Street as `[0, 8, 20, 35]` to prove it's live |
| 8 · Retention | 90d/7d are placeholders; Yassine confirming with the client. Not blocking. | **Deferred** — no code depends on a retention number yet (no History feature built). |

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
