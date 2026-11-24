import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/layout.css'
import App from './App'
import type { NocClient } from './api/client'
import { HttpNocClient } from './api/http/HttpNocClient'
import { MockNocClient } from './api/mock/MockNocClient'
import { applyStoredAppearance } from './domain/appearance'
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
  store = new NocStore(client, { connectAfterSignIn: true })
} else {
  const mock = new MockNocClient()
  store = new NocStore(mock)
  void store.connect().then(() => mock.start())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
)
