/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The stub server (`npm run stub`, server/stub.ts) listens here. Only used when
// the app runs with VITE_NOC_API=http; the default mock mode never calls /api.
const STUB = 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    // Same origin for the browser, so the session cookie (API-CONTRACT.md §2e)
    // needs no CORS and the WebSocket upgrade carries it automatically.
    proxy: { '/api': { target: STUB, ws: true } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
})
