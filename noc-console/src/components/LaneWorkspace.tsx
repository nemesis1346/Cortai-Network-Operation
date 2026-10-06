import { useState, type CSSProperties } from 'react'
import type { Alert, Incident, LedgerEvent, RiskFactorWeight, Snapshot } from '../api/types'
import { ladderLabel, laneLetter, ledgerKindLabel } from '../domain/rules'
import { attendedSec, fmtClock, incidentAgeSec, plural, secondsToNextStage, unattendedSec } from '../domain/timing'
import { useHoldToArm } from '../hooks/useHoldToArm'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { groupLedger } from '../store/selectors'
import { VideoSlot } from './VideoSlot'

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const
const WEIGHT_BARS: Record<RiskFactorWeight, number> = { high: 3, medium: 2, low: 1 }

function shortSite(name: string): string {
  return name.replace(/^\d+\s/, '').split(',')[0] ?? name
}

/**
 * The focused incident, full width: watch (video, evidence, timeline) on the
 * left, decide (why this alert, response ladder, deterrents, note, close) on
 * the right — replacing the old 1/2/2+mini grid entirely (v2 LaneWorkspace,
 * COMPONENTS.md §Lane). The "focused lane collapses to 210px" bug class
 * (audit C3/C4/A12) can't recur here by construction: there is only ever one
 * workspace, sized by the layout, never by array position.
 *
 * Judgment calls made here, not a direct spec read — worth checking with
 * Oleg if they come up: (1) evidence and timeline are stacked in the watch
 * column rather than tabbed, since Tabs' third sibling (Transcript) belongs
 * to the Comms Dock that doesn't exist yet (Part 5) — may convert to tabs
 * once it does. (2) Two-way talk stays a click-toggle, not real push-to-talk,
 * for the same reason: true hold-to-talk is entangled with the Comms Dock's
 * mic placement, which this part deliberately doesn't touch.
 */
export function LaneWorkspace({ inc, alert, server }: { inc: Incident; alert: Alert; server: Snapshot }) {
  const store = useStore()
  const now = useNow()
  const [noteDraft, setNoteDraft] = useState('')

  const letter = laneLetter(inc)
  const accent = LANE_ACCENT[inc.laneIndex] ?? 'lane-a'
  const site = server.sites.find((s) => s.id === inc.siteId)
  const camera = server.cameras.find((c) => c.id === inc.cameraId)
  const watch = server.watch.find((w) => w.siteId === inc.siteId)
  const micOn = server.micOwnerIncidentId === inc.id

  const age = incidentAgeSec(inc, now)
  const att = attendedSec(inc, now)
  const unatt = unattendedSec(inc, now)
  const nextIn = secondsToNextStage(inc.ladder, now)
  const ladderText = ladderLabel(inc.ladder, inc.operatorOwned)

  const allEvidence = server.evidence.filter((e) => e.incidentId === inc.id)
  const thumbs = allEvidence.slice(-7).reverse()
  const ledger = server.ledger.filter((e) => e.incidentId === inc.id)
  const timelineGroups = groupLedger(ledger)

  const sirenHold = useHoldToArm(() => void store.setSiren(inc.id, true))
  const strobeHold = useHoldToArm(() => void store.setStrobe(inc.id, true))

  const submitNote = () => {
    const v = noteDraft.trim()
    if (!v) return
    void store.addNote(v).then((ok) => {
      if (ok) setNoteDraft('')
    })
  }

  return (
    <article className={`workspace ${accent}`} aria-label={`Focused lane ${letter} · ${alert.title}`}>
      <header className="ws-head">
        <span className="lane-key" title={`Focus — key ${letter}`}>{letter}</span>
        <div className="ws-head-main">
          <b className="ws-site">{shortSite(site?.name ?? inc.siteId)}</b>
          <span className="ws-summary">{alert.title}</span>
        </div>
        <span className="ws-open mono" title={`Attended ${fmtClock(att)} · Unattended ${fmtClock(unatt)}`}>
          Open {fmtClock(age)}
        </span>
        <span className="owner mine">You</span>
        <button className="btn ws-close-btn" onClick={() => store.openCloseout(inc.id)}>
          Close incident
        </button>
      </header>

      <div className="ws-body">
        <div className="ws-watch">
          <div className="lfeed ws-video">
            <VideoSlot
              cameraId={inc.cameraId}
              tier="full"
              signal={camera?.signal}
              latencyMs={camera?.latencyMs}
              detections={alert.detections}
            />
            <div className="osd tl">
              <span className="tag rec">● REC</span>
              <span className="tag mono">CAM {inc.cameraId}</span>
            </div>
            <div className="osd br">
              <span className="tag mono">Full · 4K</span>
            </div>
          </div>

          <div className="ev ws-evidence">
            <span className="ev-l">Evidence</span>
            {thumbs.length ? (
              thumbs.map((e, ix) => (
                <span key={e.id} className={`thumb thumb-${e.kind} ${ix === 0 ? 'new' : ''}`} title={e.description}>
                  <i>{e.capturedAt.slice(11, 16)}</i>
                </span>
              ))
            ) : (
              <span className="capturing">capturing…</span>
            )}
            <span className="ev-n">{plural(allEvidence.length, 'still')}</span>
          </div>

          <div className="ws-timeline">
            <h3 className="ws-sub-h">Timeline</h3>
            <div className="ledger">
              {timelineGroups.length ? (
                timelineGroups.map((g) =>
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
                <p className="empty">No events yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="ws-decide">
          <div className="ws-factors">
            <h3 className="ws-sub-h">Why this alert</h3>
            <div className="factors">
              {alert.riskFactors.map((f) => (
                <span key={f.label} className={`factor factor-${f.weight}`}>
                  <span className="factor-bars" aria-hidden="true">
                    {Array.from({ length: 3 }, (_, i) => (
                      <i key={i} className={i < WEIGHT_BARS[f.weight] ? 'on' : ''} />
                    ))}
                  </span>
                  {f.label}
                </span>
              ))}
              {watch?.band === 'hi' && (
                <span className="factor factor-high">
                  <span className="factor-bars" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span>
                  Watch {watch.score} {watch.trend > 0 ? '+' : ''}{watch.trend}
                </span>
              )}
            </div>
          </div>

          <div className="ws-ladder">
            <h3 className="ws-sub-h">Response ladder</h3>
            <div className="lstage">
              <span className="pips">
                {inc.ladder.stages.map((s) => (
                  <i
                    key={s.index}
                    className={
                      inc.ladder.firedStage > s.index ? 'done' : inc.ladder.firedStage === s.index ? `now${s.index === 3 ? ' red' : ''}` : ''
                    }
                  />
                ))}
              </span>
              <span>{ladderText}</span>
              {nextIn !== null && <span className="nx">Next in {nextIn}s</span>}
            </div>
            <div className="ladder-controls">
              <button className="btn sm" onClick={() => void store.haltLadder(inc.id)} disabled={inc.ladder.status !== 'running'}>
                Halt <kbd>H</kbd>
              </button>
              <button className="btn sm" onClick={() => void store.resumeLadder(inc.id)} disabled={inc.ladder.status !== 'halted'}>
                Resume <kbd>R</kbd>
              </button>
            </div>
          </div>

          <div className="ws-actions">
            <button className="action-btn action-talk" aria-pressed={micOn} onClick={() => void store.toggleMic(inc.id)}>
              <span className="action-verb">{micOn ? 'On air' : 'Two-way talk'}</span>
              <span className="action-state">{micOn ? 'end call' : 'tap to start'}</span>
              <kbd>Space</kbd>
            </button>
            <button
              className={`action-btn action-siren ${sirenHold.holding ? 'holding' : ''}`}
              style={sirenHold.holding ? { '--hold': sirenHold.progress } as CSSProperties : undefined}
              aria-pressed={inc.siren}
              onClick={() => {
                if (sirenHold.justArmed()) return // trailing click from the hold gesture itself
                if (inc.siren) void store.setSiren(inc.id, false)
              }}
              {...sirenHold.handlers}
            >
              <span className="action-verb">Siren</span>
              <span className="action-state">{inc.siren ? 'on · click to stop' : 'hold 600ms to arm'}</span>
              <kbd>S</kbd>
            </button>
            <button
              className={`action-btn action-strobe ${strobeHold.holding ? 'holding' : ''}`}
              style={strobeHold.holding ? { '--hold': strobeHold.progress } as CSSProperties : undefined}
              aria-pressed={inc.strobe}
              onClick={() => {
                if (strobeHold.justArmed()) return // trailing click from the hold gesture itself
                if (inc.strobe) void store.setStrobe(inc.id, false)
              }}
              {...strobeHold.handlers}
            >
              <span className="action-verb">Strobe</span>
              <span className="action-state">{inc.strobe ? 'on · click to stop' : 'hold 600ms to arm'}</span>
              <kbd>L</kbd>
            </button>
          </div>

          <div className="ws-note">
            <label className={`note-label ${accent}`} htmlFor="note-in">
              Note → Lane {letter} · {site?.name ?? inc.siteId}
            </label>
            <input
              id="note-in"
              className={`note-input ${accent}`}
              placeholder="Enter — save"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNote()
              }}
            />
          </div>
        </div>
      </div>
    </article>
  )
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
