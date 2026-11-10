import { useState } from 'react'
import { CloseoutModal } from './components/CloseoutModal'
import { CommandPalette } from './components/CommandPalette'
import { ConnectionBanner } from './components/ConnectionBanner'
import { EscalationBar } from './components/EscalationBar'
import { HelpModal } from './components/HelpModal'
import { HistoryModal } from './components/HistoryModal'
import { MicConfirmDialog } from './components/MicConfirmDialog'
import { RecordModal } from './components/RecordModal'
import { Center, LeftRail, RightRail } from './components/Regions'
import { SettingsModal } from './components/SettingsModal'
import { ShiftReportModal } from './components/ShiftReportModal'
import { LockScreen } from './components/LockScreen'
import { ShortcutsLegend } from './components/ShortcutsLegend'
import { SignInScreen } from './components/SignInScreen'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { TopBar } from './components/TopBar'
import { ViewportGate } from './components/ViewportGate'
import { useHotkeys } from './hooks/useHotkeys'
import { useIdleLock } from './hooks/useIdleLock'
import { useAuth, useServer, useStore } from './store/context'

export default function App() {
  const store = useStore()
  const server = useServer()
  const auth = useAuth()
  const [rail, setRail] = useState<'left' | 'right' | null>(null)
  useHotkeys(store)
  useIdleLock(store, auth.status === 'active', (server?.incidents.length ?? 0) > 0)

  if (!server) return <p className="empty" style={{ padding: 24 }}>Connecting…</p>
  // The mock "server" connects regardless of session (lane timers/ladder run
  // either way) — this is the only thing gating the console UI itself.
  // HelpModal comes along on both screens too: F1 still needs to reach the
  // sign-in/lock-screen articles while they're what's actually on screen.
  if (auth.status === 'signed-out') {
    return (
      <>
        <SignInScreen />
        <HelpModal />
      </>
    )
  }
  if (auth.status === 'locked') {
    return (
      <>
        <LockScreen />
        <HelpModal />
      </>
    )
  }

  return (
    <ViewportGate>
      <div className={`shell rail-${rail ?? 'none'}`}>
        <TopBar server={server} onOpenRail={(r) => setRail(rail === r ? null : r)} />
        <ConnectionBanner />
        <EscalationBar server={server} />
        <div className="body">
          {/* DOM order = tab order: centre, right rail, left rail (audit A5). CSS places them visually. */}
          <Center server={server} />
          <RightRail server={server} />
          <LeftRail server={server} />
        </div>
        <StatusBar server={server} />
      </div>
      <CloseoutModal />
      <HistoryModal />
      <RecordModal />
      <ShiftReportModal />
      <SettingsModal />
      <CommandPalette />
      <HelpModal />
      <MicConfirmDialog />
      <ShortcutsLegend />
      <Toasts />
    </ViewportGate>
  )
}
