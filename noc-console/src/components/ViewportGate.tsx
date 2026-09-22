import { useState, type ReactNode } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery'

/** Below 1024px show the gate screen (audit A13). */
export function ViewportGate({ children }: { children: ReactNode }) {
  const narrow = useMediaQuery('(max-width: 1023px)')
  const [forced, setForced] = useState(false)
  if (!narrow || forced) return <>{children}</>
  return (
    <div className="gate" role="alertdialog" aria-labelledby="gate-t">
      <h1 id="gate-t">This console is designed for widths from 1280 px</h1>
      <p>Open it on a desk display, or continue with a reduced layout.</p>
      <button className="btn" onClick={() => setForced(true)}>Continue anyway</button>
    </div>
  )
}
