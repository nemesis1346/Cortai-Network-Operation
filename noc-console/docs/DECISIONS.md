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

Still open, pending a 30-minute Oleg/Yassine call on Figma (both touch operator attention, "the core of
this console"):
- The single Lane Workspace replacing the current 1/2/2+mini grid.
- The camera wall staying open while incidents are open (vs. the brief's "locked while open").

**I can't schedule or attend that call** — it's between Yassine and Oleg. I can prepare specific
questions grounded in the audit/STATES.md if useful (e.g., what exactly breaks "attention" per
`STATES.md` §2 — a dialog over the focused lane doesn't, but opening a camera view does — and whether
that distinction survives the wall staying open).

Everything else approved in the deviations table (estate tree replacing the camera ribbon, Comms Dock
replacing the voice strip, the mic hand-off dropping its confirm step for an explicit button, the
1440/1024 breakpoints, the rest of the new token system) is **not yet built**. These are mostly tied to
the same region layout the two blocked items touch — building them now risks redoing the work once the
Lane Workspace call lands. Holding them until after that call, per the plan at the end of the sign-off
memo: "start the Kept items and the engineering contracts now" — which is what §1a, the queue
decisions, and `API-CONTRACT.md` are.
