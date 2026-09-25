import { useEffect } from 'react'
import { useStore, useUi } from '../store/context'

/** Confirmations that need no decision (audit A20 reserves toasts for these;
 * refusals that need a response, like the lane limit, live at the point of action instead). */
export function Toasts() {
  const store = useStore()
  const ui = useUi()
  const toast = ui.toast

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => store.dismissToast(toast.id), 2600)
    return () => clearTimeout(t)
  }, [toast, store])

  if (!toast) return null
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live={toast.kind === 'warn' ? 'assertive' : 'polite'}>
      {toast.text}
    </div>
  )
}
