import { useEffect } from 'react'
import { derivePriority } from '../domain/rules'
import { fmtClock } from '../domain/timing'
import { useServer, useStore, useUi } from '../store/context'
import { closedByHour, shiftReportKpis } from '../store/selectors'

function buildSummaryText(server: NonNullable<ReturnType<typeof useServer>>): string {
  const kpis = shiftReportKpis(server)
  const lines = [
    `Shift report · ${server.shift.operator.name} · desk ${server.shift.operator.desk}`,
    `Incidents closed: ${kpis.closedCount}`,
    `Avg attended: ${fmtClock(kpis.avgAttendedSec)} · Avg unattended: ${fmtClock(kpis.avgUnattendedSec)}`,
    `Operator visits: ${kpis.visits} · Notes filed: ${kpis.notes}`,
    '',
    'Closed this shift:',
    ...server.closedThisShift.map((c) => {
      const site = server.sites.find((s) => s.id === c.siteId)?.name ?? c.siteId
      const p = derivePriority(c)
      const t = c.closedAt.slice(11, 16)
      return `- ${t} · ${site} · ${p} · ${c.alertTitle} · attended ${fmtClock(c.attendedSec)}`
    }),
  ]
  return lines.join('\n')
}

/**
 * v2 COMPONENTS.md#ShiftReportModal: KPIs, incidents-by-hour, closed-this-
 * shift table (only the table scrolls — `.sr-table-wrap`, not the whole
 * modal body), Copy summary. All figures derive from `closedThisShift` /
 * `stats`, both already maintained server-side; nothing new to compute on
 * the server, just a read-only view over what's already there.
 */
export function ShiftReportModal() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()

  useEffect(() => {
    if (!ui.shiftReportOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.setShiftReportOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.shiftReportOpen, store])

  if (!ui.shiftReportOpen || !server) return null

  const kpis = shiftReportKpis(server)
  const hours = closedByHour(server)
  const maxHour = Math.max(1, ...hours)

  const copySummary = () => {
    navigator.clipboard
      .writeText(buildSummaryText(server))
      .then(() => store.toast('Summary copied', 'info'))
      .catch(() => store.toast('Could not copy — clipboard unavailable', 'warn'))
  }

  return (
    <div className="modal-backdrop" onClick={() => store.setShiftReportOpen(false)}>
      <div
        className="modal report shift-report"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sr-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b id="sr-title">Shift report</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.setShiftReportOpen(false)}>✕</button>
        </div>

        <div className="sr-kpis">
          <div className="sr-kpi"><b className="mono">{kpis.closedCount}</b><span>Closed</span></div>
          <div className="sr-kpi"><b className="mono">{fmtClock(kpis.avgAttendedSec)}</b><span>Avg attended</span></div>
          <div className="sr-kpi"><b className="mono">{fmtClock(kpis.avgUnattendedSec)}</b><span>Avg unattended</span></div>
          <div className="sr-kpi"><b className="mono">{kpis.visits}</b><span>Visits</span></div>
        </div>

        <div className="sr-hours">
          <span className="ws-sub-h">Incidents by hour</span>
          <div className="sr-hours-row" aria-hidden="true">
            {hours.map((n, h) => (
              <i key={h} className={n > 0 ? 'hot' : ''} style={{ height: `${Math.max(4, (n / maxHour) * 100)}%` }} />
            ))}
          </div>
        </div>

        <div className="sr-table-wrap">
          {server.closedThisShift.length ? (
            <table className="sr-table">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Site</th>
                  <th>Priority</th>
                  <th>Alert</th>
                  <th>Attended</th>
                </tr>
              </thead>
              <tbody>
                {server.closedThisShift.map((c) => {
                  const site = server.sites.find((s) => s.id === c.siteId)?.name ?? c.siteId
                  return (
                    <tr key={c.incidentId}>
                      <td className="mono">{c.closedAt.slice(11, 16)}</td>
                      <td>{site}</td>
                      <td className="mono">{derivePriority(c)}</td>
                      <td>{c.alertTitle}</td>
                      <td className="mono">{fmtClock(c.attendedSec)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="empty">No incidents closed yet this shift.</p>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={copySummary}>Copy summary</button>
          <button className="btn primary" onClick={() => store.setShiftReportOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  )
}
