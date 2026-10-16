import { useEffect, useMemo, useRef, useState } from 'react'
import type { Snapshot } from '../api/types'
import { derivePriority, laneLetter } from '../domain/rules'
import type { NocStore } from '../store/store'
import { useServer, useStore, useUi } from '../store/context'
import { incidentsByLane, mostEscalatedIncident } from '../store/selectors'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  /** v2 COMPONENTS.md#CommandPalette: "Destructive commands require Enter
   * twice." The only one in this set that fires immediately on a single
   * Enter rather than going through an existing on-screen confirm dialog. */
  destructive?: boolean
  run: () => void
}

/**
 * v2 COMPONENTS.md#CommandPalette: Ctrl/⌘+K, search and actions. Simplified
 * from the full spec in one deliberate way — no `scope: LaneId | 'all'` tab.
 * With a 3-lane cap, the "Lanes" group below already lets you jump to any
 * lane directly, and "Focused lane" actions are already scoped to the one
 * lane that's focused — a dedicated scope tab didn't add proportional value
 * at this app's size. Flagged as a simplification, not an oversight.
 */
function buildCommands(server: Snapshot, store: NocStore): { group: string; items: Command[] }[] {
  const lanes = incidentsByLane(server)
  const focusId = server.focusIncidentId
  const focused = lanes.find((l) => l.id === focusId) ?? null

  const laneCommands: Command[] = lanes.map((inc) => {
    const alert = server.alerts.find((a) => a.id === inc.alertId)
    const site = server.sites.find((s) => s.id === inc.siteId)
    return {
      id: `focus-${inc.id}`,
      label: `Focus lane ${laneLetter(inc)} · ${site?.name ?? inc.siteId}`,
      hint: alert?.title,
      group: 'Lanes',
      run: () => void store.requestFocus(inc.id),
    }
  })

  const focusedCommands: Command[] = focused
    ? [
        {
          id: 'halt', label: 'Halt ladder', group: 'Focused lane',
          run: () => void store.haltLadder(focused.id),
        },
        {
          id: 'resume', label: 'Resume ladder', group: 'Focused lane',
          run: () => void store.resumeLadder(focused.id),
        },
        {
          id: 'mic', label: 'Move mic here', group: 'Focused lane',
          run: () => void store.toggleMic(focused.id),
        },
        {
          id: 'close', label: 'Close incident', group: 'Focused lane',
          run: () => store.openCloseout(focused.id),
        },
        ...(focused.ladder.status !== 'complete'
          ? [{
              id: 'dispatch', label: 'Confirm dispatch', group: 'Focused lane', destructive: true,
              run: () => void store.confirmDispatch(focused.id),
            }]
          : []),
      ]
    : []

  const escalating = mostEscalatedIncident(server, Date.now())
  const escalationCommands: Command[] = escalating
    ? [{
        id: 'ack', label: `Acknowledge escalation · Lane ${laneLetter(escalating)}`, group: 'Lanes',
        run: () => void store.acknowledgeEscalation(escalating.id),
      }]
    : []

  const queueCommands: Command[] = server.alerts
    .filter((a) => a.state === 'new')
    .map((a) => {
      const site = server.sites.find((s) => s.id === a.siteId)
      return {
        id: `open-${a.id}`,
        label: a.title,
        hint: `${derivePriority(a)} · ${site?.name ?? a.siteId}`,
        group: 'Queue',
        run: () => void store.openIncident(a.id),
      }
    })

  const navCommands: Command[] = [
    { id: 'wall', label: 'Open camera wall', group: 'Navigation', run: () => store.toggleWall() },
    { id: 'shift', label: 'Shift report', group: 'Navigation', run: () => store.setShiftReportOpen(true) },
    { id: 'settings', label: 'Settings', group: 'Navigation', run: () => store.setSettingsOpen(true) },
    { id: 'page2', label: 'Page second desk', group: 'Navigation', run: () => void store.pageSecondDesk() },
    { id: 'help', label: 'Keyboard shortcuts', group: 'Navigation', run: () => store.setShortcutsOpen(true) },
  ]

  const all = [...laneCommands, ...escalationCommands, ...focusedCommands, ...queueCommands, ...navCommands]
  const groups: { group: string; items: Command[] }[] = []
  for (const c of all) {
    let g = groups.find((x) => x.group === c.group)
    if (!g) {
      g = { group: c.group, items: [] }
      groups.push(g)
    }
    g.items.push(c)
  }
  return groups
}

export function CommandPalette() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!ui.paletteOpen) return
    setQuery('')
    setActiveIndex(0)
    setPendingId(null)
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [ui.paletteOpen])

  const groups = useMemo(() => {
    if (!server || !ui.paletteOpen) return []
    const all = buildCommands(server, store)
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all
      .map((g) => ({ group: g.group, items: g.items.filter((c) => c.label.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length)
  }, [server, store, query, ui.paletteOpen])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  if (!ui.paletteOpen || !server) return null

  const close = () => store.setPaletteOpen(false)
  const run = (c: Command) => {
    if (c.destructive && pendingId !== c.id) {
      setPendingId(c.id)
      return
    }
    close()
    c.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1))
      setPendingId(null)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      setPendingId(null)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = flat[activeIndex]
      if (c) run(c)
    }
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search lanes, queue, actions…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
            setPendingId(null)
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-results" role="listbox">
          {flat.length === 0 ? (
            <p className="empty">No matches.</p>
          ) : (
            groups.map((g) => (
              <div className="palette-group" key={g.group}>
                <span className="palette-group-h">{g.group}</span>
                {g.items.map((c) => {
                  const index = flat.indexOf(c)
                  const active = index === activeIndex
                  const armed = pendingId === c.id
                  return (
                    <button
                      key={c.id}
                      role="option"
                      aria-selected={active}
                      className={`palette-item ${active ? 'active' : ''} ${armed ? 'armed' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => run(c)}
                    >
                      <span className="palette-item-label">{c.label}</span>
                      {armed ? (
                        <span className="palette-item-hint warn">Press Enter again to confirm</span>
                      ) : (
                        c.hint && <span className="palette-item-hint">{c.hint}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
