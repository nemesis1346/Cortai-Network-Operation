import { fmtClock } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useConnection, useStore } from '../store/context'

/**
 * v2 connection-lost (Yassine, 3 Nov). Sits under the top bar, its own grid
 * row (layout.css) alongside EscalationBar — both can show at once. Nothing
 * in MockNocClient actually goes offline; this reflects the client-only
 * ConnectionState the command palette's "Simulate: connection lost" drives.
 */
export function ConnectionBanner() {
  const store = useStore()
  const connection = useConnection()
  const now = useNow()

  if (connection.status !== 'offline' || !connection.since) return null
  const offlineSec = Math.max(0, Math.floor((now - Date.parse(connection.since)) / 1000))

  return (
    <div className="connection-band" role="alert" aria-live="assertive">
      <span aria-hidden="true">■</span>
      <span>
        <b>Connection lost</b> · {fmtClock(offlineSec)} offline. Taking alarms, talk-down, siren,
        strobe, raising incidents and dispatch are refused — nothing is queued to fire later.
      </span>
      <button className="btn" onClick={() => store.retryNow()}>Retry now</button>
    </div>
  )
}
