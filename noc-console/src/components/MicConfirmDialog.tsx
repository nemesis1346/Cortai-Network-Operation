import { useEffect } from 'react'
import { useServer, useStore, useUi } from '../store/context'

/** Replaces window.confirm() for a mic hand-off across lanes (audit C7):
 * the native dialog blocked the whole page, including other lanes' countdowns. */
export function MicConfirmDialog() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()
  const c = ui.micConfirm

  useEffect(() => {
    if (!c) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.cancelMicMove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [c, store])

  if (!c || !server) return null
  const from = server.incidents.find((i) => i.id === c.fromIncidentId)
  const fromSite = from ? (server.sites.find((s) => s.id === from.siteId)?.name ?? from.siteId) : 'another site'

  return (
    <div className="modal-backdrop">
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="mic-confirm-title">
        <p id="mic-confirm-title">Microphone is open to {fromSite}.</p>
        <p>{c.then === 'mic' ? 'Move it here and close that channel?' : 'Switch focus and close that channel?'}</p>
        <div className="modal-foot">
          <button className="btn" onClick={() => store.cancelMicMove()}>Cancel</button>
          <button className="btn primary" onClick={() => void store.confirmMicMove()}>Confirm</button>
        </div>
      </div>
    </div>
  )
}
