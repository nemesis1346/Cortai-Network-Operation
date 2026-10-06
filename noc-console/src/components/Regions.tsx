import type { Snapshot } from '../api/types'
import { CameraRibbon } from './CameraRibbon'
import { EstateTree } from './EstateTree'
import { Lanes } from './Lanes'
import { PeripheralLanes } from './PeripheralLanes'
import { Queue } from './Queue'
import { VoiceStripBody } from './VoiceStrip'
import { WatchList } from './WatchList'

export const LeftRail = ({ server }: { server: Snapshot }) => (
  <aside className="col rail-l" aria-label="Estate and watch list">
    <EstateTree server={server} />
    <WatchList server={server} />
  </aside>
)

export const Center = ({ server }: { server: Snapshot }) => (
  <main className="col center" aria-label="Incidents">
    <Lanes server={server} />
    <CameraRibbon server={server} />
  </main>
)

export const RightRail = ({ server }: { server: Snapshot }) => (
  <aside className="col rail-r" aria-label="Queue and other lanes">
    <Queue server={server} />
    <PeripheralLanes server={server} />
  </aside>
)

export const VoiceStrip = ({ server }: { server: Snapshot }) => (
  <footer className="voice" aria-label="Voice channel">
    <VoiceStripBody server={server} />
  </footer>
)
