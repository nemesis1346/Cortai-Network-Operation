import { useState } from 'react'
import type { LedgerEvent, LedgerKind, Snapshot } from '../api/types'
import { ledgerKindLabel, laneLetter } from '../domain/rules'
import { attendedSec, fmtClock, plural, unattendedSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { groupLedger } from '../store/selectors'

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'entered', label: 'Entered' },
  { id: 'voice', label: 'Voice' },
  { id: 'note', label: 'Notes' },
  { id: 'action', label: 'Actions' },
] as const
type Filter = (typeof FILTERS)[number]['id']

function matchesFilter(kind: LedgerKind, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'entered') return kind === 'enter' || kind === 'leave'
  return kind === filter
}

function StillsRow({ events }: { events: LedgerEvent[] }) {
  const [open, setOpen] = useState(false)
  const first = events[events.length - 1]!
  const last = events[0]!
  return (
    <div className="led still-group">
      <button className="still-summary" onClick={() => setOpen((v) => !v)}>
        <span>{plural(events.length, 'still')} captured · {first.at.slice(11, 16)}–{last.at.slice(11, 16)}</span>
        <span className="disclosure" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open &&
        events.map((e) => (
          <div key={e.id} className="led still">
            <span className="ts mono">{e.at.slice(11, 19)}</span>
            <span>{e.text}</span>
          </div>
        ))}
    </div>
  )
}

/** Attended/unattended/visits, the ledger (grouped per audit A7), and the note input. */
export function LaneActivity({ server }: { server: Snapshot }) {
  const store = useStore()
  const now = useNow()
  const [filter, setFilter] = useState<Filter>('all')
  const [draft, setDraft] = useState('')

  const inc = server.incidents.find((i) => i.id === server.focusIncidentId) ?? null
  const site = inc ? server.sites.find((s) => s.id === inc.siteId) : null
  const accent = inc ? (LANE_ACCENT[inc.laneIndex] ?? 'lane-a') : ''

  const ledger = inc ? server.ledger.filter((e) => e.incidentId === inc.id) : []
  const groups = groupLedger(ledger.filter((e) => matchesFilter(e.kind, filter)))

  const liveAttended = server.incidents.reduce((n, i) => n + attendedSec(i, now), 0)
  const liveUnattended = server.incidents.reduce((n, i) => n + unattendedSec(i, now), 0)
  const totalAttended = server.stats.closedAttendedSec + liveAttended
  const totalUnattended = server.stats.closedUnattendedSec + liveUnattended

  const submitNote = () => {
    const v = draft.trim()
    if (!v) return
    void store.addNote(v).then((ok) => {
      if (ok) setDraft('')
    })
  }

  return (
    <section className="activity-region" aria-labelledby="h-activity">
      <h2 className="hd" id="h-activity">Lane activity</h2>
      <div className="region-body activity-body">
        {inc ? (
          <>
            <div className="act-head">Lane {laneLetter(inc)} · {site?.name ?? inc.siteId}</div>
            <div className="act-times">
              <div><u>Attended</u><b className="mono">{fmtClock(attendedSec(inc, now))}</b></div>
              <div><u>Unattended</u><b className="mono">{fmtClock(unattendedSec(inc, now))}</b></div>
              <div><u>Visits</u><b className="mono">{inc.visits}</b></div>
            </div>

            <div className="led-filters" role="group" aria-label="Filter ledger">
              {FILTERS.map((f) => (
                <button key={f.id} className={`chipbtn ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="ledger">
              {groups.length ? (
                groups.map((g) =>
                  g.kind === 'stills' ? (
                    <StillsRow key={g.events[0]!.id} events={g.events} />
                  ) : (
                    <div key={g.event.id} className={`led ${g.event.kind}`}>
                      <span className="ts mono">{g.event.at.slice(11, 19)}</span>
                      <span><i>{ledgerKindLabel(g.event.kind)}</i>{g.event.text}</span>
                    </div>
                  ),
                )
              ) : (
                <p className="empty">No events yet for this lane.</p>
              )}
            </div>

            <label className={`note-label ${accent}`} htmlFor="note-in">
              Note → Lane {laneLetter(inc)} · {site?.name ?? inc.siteId}
            </label>
            <input
              id="note-in"
              className={`note-input ${accent}`}
              placeholder="Enter — save"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNote()
              }}
            />
          </>
        ) : (
          <p className="empty">Focus a lane to record time and notes against it.</p>
        )}

        <p className="tie-break">Priority order: inside property line, then watch index, then age.</p>

        <div className="shift-stats">
          <div><u>Attended / unattended</u><b className="mono">{fmtClock(totalAttended)} / {fmtClock(totalUnattended)}</b></div>
          <div><u>Visits</u><b className="mono">{server.stats.visits}</b></div>
          <div><u>Notes</u><b className="mono">{server.stats.notes}</b></div>
        </div>
      </div>
    </section>
  )
}
