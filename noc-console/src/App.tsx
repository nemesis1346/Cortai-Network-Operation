import { useState } from 'react'
import { CriticalBand } from './components/CriticalBand'
import { Center, LeftRail, RightRail, VoiceStrip } from './components/Regions'
import { TopBar } from './components/TopBar'
import { ViewportGate } from './components/ViewportGate'
import { useHotkeys } from './hooks/useHotkeys'
import { useServer, useStore } from './store/context'

export default function App() {
  const store = useStore()
  const server = useServer()
  const [rail, setRail] = useState<'left' | 'right' | null>(null)
  useHotkeys(store)

  if (!server) return <p className="empty" style={{ padding: 24 }}>Connecting…</p>

  return (
    <ViewportGate>
      <div className={`shell rail-${rail ?? 'none'}`}>
        <TopBar server={server} onOpenRail={(r) => setRail(rail === r ? null : r)} />
        <CriticalBand server={server} />
        <div className="body">
          {/* DOM order = tab order: centre, right rail, left rail (audit A5). CSS places them visually. */}
          <Center server={server} />
          <RightRail server={server} />
          <LeftRail />
        </div>
        <VoiceStrip />
      </div>
    </ViewportGate>
  )
}
