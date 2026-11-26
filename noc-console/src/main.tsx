import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/layout.css'
import App from './App'
import type { NocClient } from './api/client'
import { HttpNocClient } from './api/http/HttpNocClient'
import { MockNocClient } from './api/mock/MockNocClient'
import { applyStoredAppearance } from './domain/appearance'
import { PerfProbe, startPerfProbe } from './perf/probe'
import { StoreProvider } from './store/context'
import { NocStore } from './store/store'

// Before anything else: apply the persisted theme/typeface so there's no
// flash of the wrong one while React spins up.
applyStoredAppearance()

// Composition root: the only place that knows which client is in use.
// VITE_NOC_API=http (`npm run dev:http`) talks REST + WebSocket to /api, e.g.
// the stub server (`npm run stub`); anything else is the in-browser mock.
let store: NocStore
if (import.meta.env.VITE_NOC_API === 'http') {
  // The snapshot needs a session over HTTP, so the store connects after the
  // desk pick instead of here (API-CONTRACT.md §2e).
  const client: NocClient = new HttpNocClient()
  store = new NocStore(client, { connectAfterSignIn: true, coalesceEvents: true })
} else if (import.meta.env.VITE_NOC_FIXTURE === 'load') {
  // Scale check (point 5, docs/PERFORMANCE.md): the load fixture, with 3
  // lanes opened up front. ?burst= sets events per second, ?seed= the PRNG.
  const q = new URLSearchParams(location.search)
  const mock = new MockNocClient({
    fixture: { seed: Number(q.get('seed') ?? 1), burstSize: Number(q.get('burst') ?? 50) },
  })
  store = new NocStore(mock, { coalesceEvents: true })
  void store.connect().then(async () => {
    const waiting = store.getState().server!.alerts.filter((a) => a.state === 'new').slice(0, 3)
    for (const a of waiting) await mock.openIncident(a.id)
    mock.start()
  })
} else {
  const mock = new MockNocClient({ go2rtcUrl: import.meta.env.VITE_GO2RTC_URL })
  store = new NocStore(mock, { coalesceEvents: true })
  void store.connect().then(() => mock.start())
}
if (import.meta.env.VITE_NOC_PERF === '1') startPerfProbe()
const app = import.meta.env.VITE_NOC_PERF === '1' ? <PerfProbe><App /></PerfProbe> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      {app}
    </StoreProvider>
  </StrictMode>,
)
