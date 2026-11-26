import { memo, useMemo, useState, type CSSProperties } from 'react'
import type { Alert, Incident, LedgerEvent, RiskFactorWeight, Snapshot, TranscriptLine, TranscriptSpeaker } from '../api/types'
import { derivePriority, ladderLabel, laneLetter, ledgerKindLabel } from '../domain/rules'
import { attendedSec, fmtClock, incidentAgeSec, plural, secondsToNextStage, unattendedSec } from '../domain/timing'
import { streamUrlFor } from '../domain/video'
import { useHoldToArm } from '../hooks/useHoldToArm'
import { useHoldToTalk } from '../hooks/useHoldToTalk'
import { useNow } from '../hooks/useNow'
import { useStableArray } from '../hooks/useStableArray'
import { useConnection, useStore } from '../store/context'
import { groupLedger, type LedgerGroup } from '../store/selectors'
import { CommsDock } from './CommsDock'
import { VideoSlot } from './VideoSlot'

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const
const WEIGHT_BARS: Record<RiskFactorWeight, number> = { high: 3, medium: 2, low: 1 }
const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = { sys: 'System', ai: 'AI', op: 'Operator' }

function shortSite(name: string): string {
  return name.replace(/^\d+\s/, '').split(',')[0] ?? name
}

/**
 * The focused incident, full width: watch (video, evidence, timeline/
 * transcript) on the left, decide (why this alert, response ladder, comms
 * dock, deterrents, note, close) on the right — replacing the old 1/2/2+mini
 * grid entirely (v2 LaneWorkspace, COMPONENTS.md §Lane). The "focused lane
 * collapses to 210px" bug class (audit C3/C4/A12) can't recur here by
 * construction: there is only ever one workspace, sized by the layout, never
 * by array position.
 *
 * Two Part 1 deferrals resolved here now that the Comms Dock exists: Timeline
 * and Transcript are tabs (Evidence stays always-visible, it's compact and
 * useful at a glance — the build plan only calls out Transcript becoming a
 * tab, not Evidence); Two-way talk is real hold-to-talk (`useHoldToTalk`,
 * STATES.md §4), not a click-toggle.
 */
export function LaneWorkspace({ inc, alert, server }: { inc: Incident; alert: Alert; server: Snapshot }) {
  const store = useStore()
  const connection = useConnection()
  const now = useNow()
  const [watchTab, setWatchTab] = useState<'timeline' | 'transcript'>('timeline')
  const [confirmDispatchOpen, setConfirmDispatchOpen] = useState(false)

  const letter = laneLetter(inc)
  const priority = derivePriority(alert)
  // Available even when the ladder is suppressed (e.g. allow-listed plate,
  // camera fault) — suppression stops the automated stages, not the
  // operator's own judgment call. setSiren/setStrobe already work this way
  // (no ladder-status guard at all); only 'complete' means nothing's left.
  const dispatchAvailable = inc.ladder.status !== 'complete'
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

  // Point 5: filtered once per change to the underlying list, and kept
  // reference-stable when an event for another lane didn't change this one,
  // so the memoised log below skips clock ticks, keystrokes and other lanes.
  const allEvidence = useStableArray(useMemo(() => server.evidence.filter((e) => e.incidentId === inc.id), [server.evidence, inc.id]))
  const thumbs = allEvidence.slice(-7).reverse()
  const ledger = useStableArray(useMemo(() => server.ledger.filter((e) => e.incidentId === inc.id), [server.ledger, inc.id]))
  const timelineGroups = useMemo(() => groupLedger(ledger), [ledger])
  const transcript = useStableArray(useMemo(() => server.transcript.filter((l) => l.incidentId === inc.id), [server.transcript, inc.id]))

  const sirenHold = useHoldToArm(() => void store.setSiren(inc.id, true), 600, 'siren')
  const strobeHold = useHoldToArm(() => void store.setStrobe(inc.id, true), 600, 'strobe')
  // Press claims the mic only if some other lane doesn't already have it bound
  // here — re-pressing while already bound just re-asserts "talking" locally,
  // it must never fall into toggleMic's release branch (that's M's job).
  const talkHold = useHoldToTalk(() => {
    if (server.micOwnerIncidentId !== inc.id) void store.toggleMic(inc.id)
  })

  return (
    <>
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
              streamUrl={streamUrlFor(camera, 'full')}
              signal={connection.status === 'offline' ? 'lost' : camera?.signal}
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
            <div className="tabs ws-tabs" role="tablist">
              {(['timeline', 'transcript'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={watchTab === t}
                  className="tab"
                  onClick={() => setWatchTab(t)}
                >
                  {t === 'timeline' ? 'Timeline' : 'Transcript'}
                </button>
              ))}
            </div>
            {watchTab === 'timeline' ? <TimelineLog groups={timelineGroups} /> : <TranscriptLog lines={transcript} />}
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
              <button
                className="btn sm"
                onClick={() => void store.haltLadder(inc.id)}
                disabled={inc.ladder.status !== 'running' && inc.ladder.status !== 'armed'}
              >
                Halt <kbd>H</kbd>
              </button>
              <button className="btn sm" onClick={() => void store.resumeLadder(inc.id)} disabled={inc.ladder.status !== 'halted'}>
                Resume <kbd>R</kbd>
              </button>
              {dispatchAvailable && (
                <button
                  className={`btn sm destructive ${priority === 'P3' || priority === 'P4' ? 'dim' : ''}`}
                  onClick={() => setConfirmDispatchOpen(true)}
                >
                  Confirm dispatch
                </button>
              )}
            </div>
          </div>

          <CommsDock inc={inc} server={server} onOpenTranscript={() => setWatchTab('transcript')} />

          <div className="ws-actions">
            <button
              className={`action-btn action-talk ${talkHold.pressing ? 'talking' : ''}`}
              aria-pressed={micOn}
              {...talkHold.handlers}
            >
              <span className="action-verb">Two-way talk</span>
              <span className="action-state">
                {talkHold.pressing ? 'talking — release to stop' : micOn ? 'mic open · hold to talk' : 'hold to talk'}
              </span>
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

          <NoteField accent={accent} label={`Note → Lane ${letter} · ${site?.name ?? inc.siteId}`} />
        </div>
      </div>
    </article>
    {confirmDispatchOpen && (
      <div className="modal-backdrop">
        <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="dispatch-confirm-title">
          <p id="dispatch-confirm-title">Confirm dispatch to {site?.name ?? inc.siteId}?</p>
          <p>Police will be notified. This cannot be undone.</p>
          <div className="modal-foot">
            <button className="btn" onClick={() => setConfirmDispatchOpen(false)}>Cancel</button>
            <button
              className="btn primary"
              onClick={() => {
                setConfirmDispatchOpen(false)
                void store.confirmDispatch(inc.id)
              }}
            >
              Confirm dispatch
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

/* Point 5: the log, its rows and the note field are their own memoised
 * components. The workspace above re-renders every second (its clocks) and
 * on every server event; these re-render only when their own data changes,
 * and a new log line renders just that line. */

const TimelineLog = memo(function TimelineLog({ groups }: { groups: LedgerGroup[] }) {
  return (
    <div className="ledger">
      {groups.length ? (
        groups.map((g) =>
          g.kind === 'stills' ? <StillsRow key={g.events[0]!.id} events={g.events} /> : <LedgerRow key={g.event.id} event={g.event} />,
        )
      ) : (
        <p className="empty">No events yet.</p>
      )}
    </div>
  )
})

const LedgerRow = memo(function LedgerRow({ event }: { event: LedgerEvent }) {
  return (
    <div className={`led ${event.kind}`}>
      <span className="ts mono">{event.at.slice(11, 19)}</span>
      <span><i>{ledgerKindLabel(event.kind)}</i>{event.text}</span>
    </div>
  )
})

const TranscriptLog = memo(function TranscriptLog({ lines }: { lines: TranscriptLine[] }) {
  return (
    <div className="ledger" role="log" aria-live="polite">
      {lines.length ? lines.map((l) => <TranscriptRow key={l.id} line={l} />) : <p className="empty">No transcript yet.</p>}
    </div>
  )
})

const TranscriptRow = memo(function TranscriptRow({ line }: { line: TranscriptLine }) {
  return (
    <div className={`tline ${line.speaker}`}>
      <span className="ts mono">{line.at.slice(11, 19)}</span>
      <span className="who">{SPEAKER_LABEL[line.speaker]}</span>
      <span className="tx">{line.text}</span>
    </div>
  )
})

/** Its own draft state, so typing re-renders this input, not the workspace.
 * `store.addNote` writes to the focused lane, which is this one. */
const NoteField = memo(function NoteField({ accent, label }: { accent: string; label: string }) {
  const store = useStore()
  const [draft, setDraft] = useState('')
  const submit = () => {
    const v = draft.trim()
    if (!v) return
    void store.addNote(v).then((ok) => {
      if (ok) setDraft('')
    })
  }
  return (
    <div className="ws-note">
      <label className={`note-label ${accent}`} htmlFor="note-in">{label}</label>
      <input
        id="note-in"
        className={`note-input ${accent}`}
        placeholder="Enter — save"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
    </div>
  )
})

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
