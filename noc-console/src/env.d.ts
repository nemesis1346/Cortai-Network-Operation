interface ImportMetaEnv {
  /** Which NocClient the app uses: 'mock' (default, in-browser) or 'http'
   * (REST + WebSocket against /api, e.g. the stub server). See main.tsx. */
  readonly VITE_NOC_API?: 'mock' | 'http'
  /** In mock mode: a go2rtc to stream every camera from, e.g.
   * http://localhost:1984 (video/README.md). Unset: placeholders, as before. */
  readonly VITE_GO2RTC_URL?: string
}
