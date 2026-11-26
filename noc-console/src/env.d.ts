interface ImportMetaEnv {
  /** Which NocClient the app uses: 'mock' (default, in-browser) or 'http'
   * (REST + WebSocket against /api, e.g. the stub server). See main.tsx. */
  readonly VITE_NOC_API?: 'mock' | 'http'
  /** In mock mode: a go2rtc to stream every camera from, e.g.
   * http://localhost:1984 (video/README.md). Unset: placeholders, as before. */
  readonly VITE_GO2RTC_URL?: string
  /** 'load': the scale-check fixture instead of the normal seed (mock mode
   * only). Burst size and seed come from the URL: ?burst=50&seed=1. */
  readonly VITE_NOC_FIXTURE?: 'load'
  /** '1': mount the perf probe (src/perf/probe.tsx). Set by `--mode perf`. */
  readonly VITE_NOC_PERF?: string
}
