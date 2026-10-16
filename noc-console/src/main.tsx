import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/layout.css'
import App from './App'
import type { NocClient } from './api/client'
import { MockNocClient } from './api/mock/MockNocClient'
import { applyStoredAppearance } from './domain/appearance'
import { StoreProvider } from './store/context'
import { NocStore } from './store/store'

// Before anything else: apply the persisted theme/typeface so there's no
// flash of the wrong one while React spins up.
applyStoredAppearance()

// Composition root: the only place that knows which client is in use.
// Integration: replace with an HTTP + WebSocket NocClient.
const mock = new MockNocClient()
const client: NocClient = mock
const store = new NocStore(client)
void store.connect().then(() => mock.start())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
)
