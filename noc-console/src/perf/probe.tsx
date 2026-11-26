import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'

/**
 * Scale-check probe (point 5). Only mounted in the perf build
 * (`npm run perf:build`, VITE_NOC_PERF=1), which also swaps in React's
 * profiling build so the Profiler reports real production timings.
 *
 * Records three things and exposes them on `window.__nocPerf`:
 * - every React commit (Profiler `actualDuration`: time spent rendering the
 *   tree for that commit),
 * - every animation frame's interval, so dropped frames are counted
 *   directly rather than inferred (a frame over 33 ms = at least one missed
 *   60 Hz frame),
 * - long tasks (main thread blocked > 50 ms), from the browser itself,
 * - input latency: Event Timing entries (keypress/click to next paint),
 *   the same measurement Chrome's INP is built on.
 * scripts/perf-measure.mjs drives it; docs/PERFORMANCE.md has the method.
 */
const commits: number[] = []
const frames: number[] = []
const longTasks: number[] = []
const inputs: number[] = []
const mockMs: number[] = []
let startedAt = performance.now()
let lastFrame = 0

const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration) => {
  commits.push(actualDuration)
}

export function PerfProbe({ children }: { children: ReactNode }) {
  return (
    <Profiler id="app" onRender={onRender}>
      {children}
    </Profiler>
  )
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!
}
const round = (n: number) => Math.round(n * 100) / 100

export interface PerfReport {
  seconds: number
  commits: number
  commitsPerSec: number
  renderMsPerSec: number
  commitMsMean: number
  commitMsP95: number
  commitMsMax: number
  frames: number
  fps: number
  frameMsP95: number
  framesOver33ms: number
  framesOver50ms: number
  longTasks: number
  longTaskMs: number
  inputs: number
  inputMsP95: number
  inputMsMax: number
  /** The in-page mock generating its bursts: not app cost, see loadBurst. */
  mockMsPerSec: number
  heapMB: number | null
}

export function startPerfProbe(): void {
  const loop = (t: number) => {
    if (lastFrame) frames.push(t - lastFrame)
    lastFrame = t
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
  } catch {
    // longtask isn't supported everywhere; the frame counts still stand.
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) inputs.push(e.duration)
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
  } catch {
    // Event Timing: Chromium only. Input latency is then simply not reported.
  }
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'mock-burst') mockMs.push(e.duration)
  }).observe({ type: 'measure', buffered: false })

  const w = window as unknown as { __nocPerf: { reset(): void; report(): PerfReport } }
  w.__nocPerf = {
    reset() {
      commits.length = 0
      frames.length = 0
      longTasks.length = 0
      inputs.length = 0
      mockMs.length = 0
      lastFrame = 0
      startedAt = performance.now()
    },
    report(): PerfReport {
      const seconds = (performance.now() - startedAt) / 1000
      const total = commits.reduce((a, b) => a + b, 0)
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
      return {
        seconds: round(seconds),
        commits: commits.length,
        commitsPerSec: round(commits.length / seconds),
        renderMsPerSec: round(total / seconds),
        commitMsMean: round(commits.length ? total / commits.length : 0),
        commitMsP95: round(pct(commits, 95)),
        commitMsMax: round(Math.max(0, ...commits)),
        frames: frames.length,
        fps: round(frames.length / seconds),
        frameMsP95: round(pct(frames, 95)),
        framesOver33ms: frames.filter((f) => f > 33.4).length,
        framesOver50ms: frames.filter((f) => f > 50).length,
        longTasks: longTasks.length,
        longTaskMs: round(longTasks.reduce((a, b) => a + b, 0)),
        inputs: inputs.length,
        inputMsP95: round(pct(inputs, 95)),
        inputMsMax: round(Math.max(0, ...inputs)),
        mockMsPerSec: round(mockMs.reduce((a, b) => a + b, 0) / seconds),
        heapMB: mem ? round(mem.usedJSHeapSize / 1048576) : null,
      }
    },
  }
}
