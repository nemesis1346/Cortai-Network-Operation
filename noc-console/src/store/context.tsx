import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { AuthSession, ConnectionState, Snapshot } from '../api/types'
import type { NocStore, UiState } from './store'

const Ctx = createContext<NocStore | null>(null)

export function StoreProvider({ store, children }: { store: NocStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useStore(): NocStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider missing')
  return s
}

/** Server snapshot. Null until connected. Reference-stable between events. */
export function useServer(): Snapshot | null {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => store.getState().server)
}

export function useUi(): UiState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => store.getState().ui)
}

export function useAuth(): AuthSession {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => store.getState().auth)
}

export function useConnection(): ConnectionState {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () => store.getState().connection)
}
