interface ImportMetaEnv {
  /** Which NocClient the app uses: 'mock' (default, in-browser) or 'http'
   * (REST + WebSocket against /api, e.g. the stub server). See main.tsx. */
  readonly VITE_NOC_API?: 'mock' | 'http'
}
