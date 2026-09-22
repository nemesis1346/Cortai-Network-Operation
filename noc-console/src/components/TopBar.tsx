import { useNow } from '../hooks/useNow'
import { cameraSummary } from '../store/selectors'
import type { Snapshot } from '../api/types'
import { openCount } from '../domain/rules'

function Clock() {
  const now = useNow()
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return <b className="mono">{`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`}</b>
}

export function TopBar({ server, onOpenRail }: { server: Snapshot; onOpenRail: (r: 'left' | 'right') => void }) {
  const cams = cameraSummary(server)
  const open = openCount(server.incidents)
  const decoding = open + cams.motion
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <b>Cortai</b>
        <span>NOC</span>
      </div>

      <div className="topbar-mid">
        <button className="rail-toggle" onClick={() => onOpenRail('left')}>Estate</button>
        <div className="topstat"><u>Shift clock</u><Clock /></div>
        <div className="topstat">
          <u>Operator</u>
          <b>{server.shift.operator.name} · desk {server.shift.operator.desk}</b>
        </div>
        <div className="topstat"><u>Open incidents</u><b className="mono">{open}</b></div>
        <button className="rail-toggle" onClick={() => onOpenRail('right')}>Queue</button>
      </div>

      <div className="pills">
        <span className="health">{cams.live} / {cams.total} cameras</span>
        <span className="pill warn">Decode {decoding} of {cams.total}</span>
        {cams.down > 0 && <span className="pill crit">{cams.down} camera fault</span>}
      </div>
    </header>
  )
}
