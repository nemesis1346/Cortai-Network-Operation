# Scale check (Yassine's point 5, 26 Nov)

The task was a deterministic load fixture (40+ cameras, 200 alerts in the queue, 3 lanes open, bursts of
events every second), measuring render cost, fixing anything that drops frames, and writing the numbers
down. This document holds the method, the numbers and what was fixed.

**Short version:** three real problems were found and fixed. Under the heaviest load over the real
WebSocket on a 4×-slowed CPU, the console went from **8 fps to 56 fps**. At normal CPU speed, every
scenario now holds 60 fps with no frames over 50 ms.

## The fixture

`src/api/mock/loadFixture.ts`, all from one seeded PRNG (mulberry32), so a given seed always produces
the same estate, the same queue and the same event stream:

| | |
|---|---|
| Estate | 12 sites × 4 cameras = **48 cameras**. ~6% offline, ~6% fault, ~18% motion |
| Queue | **200 alerts**, ~1 in 8 held, the rest new. 168 rows show in the New tab once 3 are taken |
| Lanes | **3 open** before measuring starts (A focused, B and C as lane cards) |
| Bursts | one per second, `?burst=` events each: ~35% camera status changes, ~30% alert re-scores, ~17% transcript lines, ~12% ledger entries, ~4% evidence, ~2% watch-score changes |

Scenarios: **idle** (0 events/s), **standard** (50/s) and **stress** (200/s). There's no agreed real-world
rate yet, so 50/s is a guess at a busy estate and 200/s is deliberately past it.

## Method

- **Production build with React's profiling build swapped in** (`npm run perf:build`, Vite mode `perf`
  aliases `react-dom/client` to `react-dom/profiling`). Dev-mode React is several times slower, so its
  numbers would overstate everything.
- **Probe** (`src/perf/probe.tsx`, only in that build): every React commit's render time (Profiler
  `actualDuration`), every animation frame's interval (so dropped frames are counted directly; a frame
  over 33 ms means at least one missed 60 Hz frame), long tasks (main thread blocked over 50 ms), input
  latency (Event Timing), and, separately, the in-page mock's own cost (`mock-burst` measures).
- **Driver:** headless Google Chrome at 1600×1000. It signs in, waits for the 3 lanes, warms up for 3 s
  and then measures for **20 s**, acting like an operator throughout: every ~1.5 s it switches lane
  (B, A, C, A) and types a short note. Every scenario runs at **1× CPU** and at **4× CPU throttling**
  (Chrome DevTools), which stands in for a slower desk PC.
- **Two transports.** *Mock*: the fixture runs in the page, as with `npm run dev`. *HTTP*: the stub
  serves the fixture (`NOC_FIXTURE=load NOC_BURST=… npm run stub`) and the app talks to it over REST +
  WebSocket (Vite mode `perf-http`). In HTTP mode no mock code runs in the page.

Reproduce: `npm run perf:build`, then serve `dist-perf` (mock) or `dist-perf-http` plus the stub (HTTP)
and open `/?burst=200&seed=1`. `window.__nocPerf.reset()` and `.report()` give the numbers. The
Playwright driver that automated the runs isn't in the repo yet (it would add `playwright-core` as a
dev dependency, which needs a yes first).

## What was found and fixed

### 1. ~60 renders a second with nothing happening (`useNow`)

Every running clock (each queue row's age, each camera's down time, …) started its own one-second
timer when it mounted. With 168 queue rows that's ~170 timers firing at ~170 different moments, each one
a separate React commit: **61 commits/s at idle**, growing with queue length. **Fix:** one shared clock per
interval, aligned to the wall-clock second, so every clock updates in the same task and React renders
them in one commit. **Result: 61 → 8–9 commits/s.** All clocks on screen now also turn over together.

### 2. The focused lane and the queue re-rendered everything on every change

Found by wrapping each region in its own Profiler (a temporary experiment, not committed). At 4× CPU
under stress, over 20 s:

| Region | Before | After |
|---|---|---|
| Lanes (focused lane) | 341 ms | 116 ms |
| Queue | 220 ms | 119 ms |
| Watch list, lane cards, estate tree, top bar, camera wall, status bar, escalation bar | ~70 ms together | ~70 ms together |

- **Lane workspace:** the clock tick, every keystroke in the note field (its draft lived in the
  workspace) and every server event, even for another lane, re-rendered the whole workspace, which
  rebuilt the timeline and transcript from scratch. Those only ever grow. **Fix:** timeline, transcript
  and their rows are memoised components. Their inputs are filtered once per change and kept
  reference-stable when the event was for another lane (`useStableArray`). The note field holds its own
  draft. Typing and clock ticks no longer touch the log, and a new log line renders only that line.
- **Queue:** every change re-sorted all 200 alerts and re-rendered all 168 rows, with a linear incident
  search per row for its lane letter. **Fix:** sorting and counts are memoised on the alert/watch lists,
  lane letters come from one map, and rows are memoised, so a burst that re-scores some alerts re-renders
  only those rows.

### 3. Over the WebSocket, every event was its own render

The mock delivers a burst synchronously, so React batches it into one render, which hid this problem.
Over the real socket every event is a separate message, so **every event became a full React commit**:
58 commits/s at 50 events/s and 176–208 at 200/s. At 4× CPU under stress that meant **8 fps**, 350
frames over 50 ms and 1.7 s of long tasks in a 20 s window. **Fix:** the store collects incoming events
and applies them once per animation frame (`coalesceEvents`, on in `main.tsx`), with a 100 ms fallback
for hidden tabs, where `requestAnimationFrame` pauses. Commands read state through an accessor that
applies anything pending first, so a command never decides from state up to a frame old. A test checks
exactly that, and fails without it. **Result: ~10 commits/s whatever the event rate.**

## Results

Per 20 s window. *Commits* and *render* are per second; *p95* is the 95th-percentile commit's render
time. Frame counts are over the whole window.

### HTTP (the real transport): before and after event coalescing

The "before" column already includes fixes 1 and 2. Only coalescing differs.

| CPU | Scenario | | Commits/s | Render ms/s | Commit p95 ms | fps | Frames >33 ms | Frames >50 ms | Long tasks |
|---|---|---|---|---|---|---|---|---|---|
| 1× | idle | before | 11 | 3.8 | 1.2 | 60 | 0 | 0 | 0 |
| 1× | idle | **after** | 9 | 1.7 | 1.2 | 60 | 0 | 0 | 0 |
| 1× | standard 50/s | before | 59 | 30.7 | 1.4 | 59 | 10 | 1 | 0 |
| 1× | standard 50/s | **after** | 9 | 3.2 | 1.7 | 59 | 1 | 1 | 0 |
| 1× | stress 200/s | before | 208 | 101.9 | 1.0 | 52 | 38 | 31 | 0 |
| 1× | stress 200/s | **after** | 10 | 3.8 | 1.9 | 60 | 0 | 0 | 0 |
| 4× | idle | before | 10 | 12.1 | 5.6 | 59 | 8 | 2 | 0 |
| 4× | idle | **after** | 8 | 5.6 | 4.7 | 59 | 3 | 0 | 0 |
| 4× | standard 50/s | before | 58 | 133.7 | 5.1 | **41** | 89 | 64 | 0 |
| 4× | standard 50/s | **after** | 9 | 13.2 | 7.7 | **59** | 8 | 1 | 1 (57 ms) |
| 4× | stress 200/s | before | 176 | 367.2 | 4.7 | **8** | 361 | 350 | 27 (1667 ms) |
| 4× | stress 200/s | **after** | 10 | 17.1 | 6.9 | **56** | 21 | 6 | 2 (117 ms) |

### Mock (in-page fixture): original code, after fix 1, after all fixes

| CPU | Scenario | | Commits/s | Render ms/s | Commit p95 ms | fps | Frames >33 ms | Frames >50 ms | Long tasks |
|---|---|---|---|---|---|---|---|---|---|
| 1× | idle | original | 61 | 5.1 | 0.2 | 60 | 0 | 0 | 0 |
| 1× | idle | shared clock | 9 | 4.4 | 2.1 | 60 | 0 | 0 | 0 |
| 1× | idle | **all fixes** | 8 | 2.5 | 1.8 | 60 | 1 | 0 | 0 |
| 1× | stress 200/s | original | 63 | 9.7 | 0.6 | 60 | 1 | 0 | 0 |
| 1× | stress 200/s | shared clock | 9 | 9.0 | 3.6 | 60 | 0 | 0 | 0 |
| 1× | stress 200/s | **all fixes** | 9 | 4.1 | 2.2 | 60 | 0 | 0 | 0 |
| 4× | standard 50/s | original | 30 | 25.1 | 4.0 | 57 | 13 | 2 | 1 (53 ms) |
| 4× | standard 50/s | **all fixes** (3 runs) | 8–9 | 10.9–12.2 | 6.5–7.2 | 57–59 | 1–7 | 0–3 | 0–3 |
| 4× | stress 200/s | original | 25 | 33.9 | 8.0 | 53 | 37 | 15 | 3 (160 ms) |
| 4× | stress 200/s | shared clock | 8 | 29.9 | 13.4 | 55 | 32 | 10 | 1 (64 ms) |
| 4× | stress 200/s | **all fixes** (3 runs) | 8–9 | 13.9–15.5 | 8.5–10.6 | 56–58 | 7–27 | 0–6 | 2–8 |

How to read these:

- **Render ms/s is the steady signal.** It fell by about half in mock mode and 20× in HTTP mode at 4× stress.
- **At 4×, frame and long-task counts are noisy.** Three identical runs of the final code gave 0–6
  frames over 50 ms and 2–8 long tasks under stress, hence the ranges. Even idle at 4× shows 3–5 frames
  over 33 ms, which is the floor of the throttled headless setup. A single run shouldn't be read as a trend.
- **Commit p95 went *up* at 1×** (0.2 → 1.8 ms at idle). That's expected: there are now far fewer
  commits, each doing what used to be spread over many tiny ones (all clocks in one commit). The total
  per second fell.
- **The mock's own cost is small:** 0.3–2.5 ms/s for generating bursts, so it doesn't distort the mock numbers.
- **Input latency** (Event Timing, keypress to next paint) stayed at 32–56 ms p95 throughout, before
  and after. It's reported in 8 ms steps, includes the wait for the next paint, and is driven by
  synthetic keystrokes, so treat it as "no regression", not as a precise figure.

### Soak: 2 minutes at 200 events/s (mock, 1×)

60 fps throughout, no frames over 50 ms, no long tasks. Two things grow with time:

| | t+46 s | t+92 s | t+120 s |
|---|---|---|---|
| Render ms/s | 4.2 | 5.0 | 5.4 |
| JS heap | 9 MB | 15 MB | 30 MB |
| Focused lane log rows | | | 1,105 |

## Open: not fixed, and why

- **Lane logs and transcript are unbounded.** Every line of the shift is kept in the snapshot and every
  line of the focused lane is rendered, so cost and memory grow linearly with events received. At 200
  events/s that's ~9 log rows/s in the focused lane and roughly 15–20 MB/min of heap (GC makes the
  heap figure jumpy; the trend is clear). Real incidents last
  minutes and real traffic is likely far below 200/s, so this hasn't been changed. If real rates come
  near this, the fix is to window the log (render the latest N, "show earlier" on demand) and to drop
  closed incidents' lines from the live snapshot (they're already sealed in their Record, Part 9).
- **Not measured:** a real network (the stub runs on localhost), a real backend's event rate (unknown,
  which is why the scenarios bracket it), and video decode cost (the fixture's cameras have no stream
  URLs; go2rtc decoding is GPU/media-pipeline work, separate from React).
- **The real event rate is the number to get.** Everything above is relative to a guessed 50/s and a
  deliberate 200/s. One hour of real event logs from a busy estate would turn these into real targets.
