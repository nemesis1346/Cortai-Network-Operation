import { useEffect, useState } from 'react'
import type { ClosedIncidentSummary } from '../api/types'
import { derivePriority, type QueuePriority } from '../domain/rules'
import { fmtClock } from '../domain/timing'
import { useServer, useStore, useUi } from '../store/context'

const PRIORITIES: QueuePriority[] = ['P1', 'P2', 'P3', 'P4']

/**
 * History (Part 9 decision note #3): browses `server.closedThisShift` —
 * this session's closed incidents only, not a separately-persisted,
 * multi-day store (see the decision note's scope paragraph). Filters are
 * Yassine's own list (date/site/priority/operator), not COMPONENTS.md's
 * older All/P1-P2/Referred segmented filter, which needs an outcome field
 * this build doesn't have.
 */
export function HistoryModal() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()
  const open = ui.historyOpen

  const [date, setDate] = useState('')
  const [siteId, setSiteId] = useState('all')
  const [priority, setPriority] = useState<'all' | QueuePriority>('all')
  const [operatorId, setOperatorId] = useState('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setDate('')
    setSiteId('all')
    setPriority('all')
    setOperatorId('all')
    setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Don't steal Escape from a Record opened on top of this list — that
      // closes first; a second press then closes History.
      if (e.key === 'Escape' && !store.getState().ui.record) store.setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, store])

  if (!open || !server) return null

  const closed = server.closedThisShift
  const siteName = (id: string) => server.sites.find((s) => s.id === id)?.name ?? id

  const sites = Array.from(new Set(closed.map((c) => c.siteId))).map((id) => ({ id, name: siteName(id) }))
  const operators = Array.from(new Map(closed.map((c) => [c.operator.id, c.operator])).values())

  const q = query.trim().toLowerCase()
  const filtered = closed.filter((c) => {
    if (date && c.closedAt.slice(0, 10) !== date) return false
    if (siteId !== 'all' && c.siteId !== siteId) return false
    if (priority !== 'all' && derivePriority(c) !== priority) return false
    if (operatorId !== 'all' && c.operator.id !== operatorId) return false
    if (q && !siteName(c.siteId).toLowerCase().includes(q) && !c.alertTitle.toLowerCase().includes(q)) return false
    return true
  })

  const filtersActive = date !== '' || siteId !== 'all' || priority !== 'all' || operatorId !== 'all' || q !== ''

  const openRow = (c: ClosedIncidentSummary) => void store.openRecord(c.incidentId)

  return (
    <div className="modal-backdrop" onClick={() => store.setHistoryOpen(false)}>
      <div
        className="modal history"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hist-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <b id="hist-title">History</b>
          <button className="modal-x" aria-label="Close" onClick={() => store.setHistoryOpen(false)}>✕</button>
        </div>

        <div className="hist-filters">
          <input
            type="date"
            className="hist-date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Closed date"
          />
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as 'all' | QueuePriority)} aria-label="Priority">
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-label="Operator">
            <option value="all">All operators</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <input
            type="search"
            className="hist-search"
            placeholder="Search site or title…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search history"
          />
        </div>

        <div className="sr-table-wrap">
          {filtered.length ? (
            <table className="sr-table">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Site</th>
                  <th>Priority</th>
                  <th>Title</th>
                  <th>Duration</th>
                  <th>Operator</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.incidentId} className="hist-row" role="button" tabIndex={0}
                    onClick={() => openRow(c)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRow(c) } }}
                  >
                    <td className="mono">{c.closedAt.slice(0, 10)} {c.closedAt.slice(11, 16)}</td>
                    <td>{siteName(c.siteId)}</td>
                    <td className="mono">{derivePriority(c)}</td>
                    <td>{c.alertTitle}</td>
                    <td className="mono">{fmtClock(c.totalSec)}</td>
                    <td>{c.operator.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : closed.length === 0 ? (
            <p className="empty">No closed incidents yet — Closed incidents land here with their full record.</p>
          ) : q ? (
            <p className="empty">No match for &lsquo;{q}&rsquo; — try a different site, title or operator.</p>
          ) : (
            <p className="empty">No incidents match these filters — try a different site, priority or operator.</p>
          )}
        </div>

        <div className="modal-foot">
          <span className="hist-count">{filtered.length} of {closed.length} closed{filtersActive ? ' (filtered)' : ''}</span>
          <button className="btn primary" onClick={() => store.setHistoryOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  )
}
