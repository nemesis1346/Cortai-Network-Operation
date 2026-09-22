import type { KeyboardEvent, MouseEvent } from 'react'
import type { Alert, Incident, Snapshot } from '../api/types'
import { ladderLabel, laneLetter } from '../domain/rules'
import { attendedSec, fmtClock, incidentAgeSec, plural, secondsToNextStage, unattendedSec } from '../domain/timing'
import { useNow } from '../hooks/useNow'
import { useStore } from '../store/context'
import { VideoSlot } from './VideoSlot'

function shortSite(name: string): string {
  return name.replace(/^\d+\s/, '').split(',')[0] ?? name
}

const LANE_ACCENT = ['lane-a', 'lane-b', 'lane-c'] as const

export function Lane({
  inc,
  alert,
  server,
  focused,
  mini,
  gridArea,
}: {
  inc: Incident
  alert: Alert
  server: Snapshot
  focused: boolean
  mini: boolean
  gridArea?: string
}) {
  const store = useStore()
  const now = useNow()

  const letter = laneLetter(inc)
  const accent = LANE_ACCENT[inc.laneIndex] ?? 'lane-a'
  const age = incidentAgeSec(inc, now)
  const att = attendedSec(inc, now)
  const unatt = unattendedSec(inc, now)
  const nextIn = secondsToNextStage(inc.ladder, now)
  const ladderText = ladderLabel(inc.ladder, inc.operatorOwned)

  const site = server.sites.find((s) => s.id === inc.siteId)
  const watch = server.watch.find((w) => w.siteId === inc.siteId)
  const micOn = server.micOwnerIncidentId === inc.id
  const allEvidence = server.evidence.filter((e) => e.incidentId === inc.id)
  const thumbs = allEvidence.slice(-7).reverse()

  const onLaneClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    void store.requestFocus(inc.id)
  }
  const onLaneKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void store.requestFocus(inc.id)
    }
  }

  return (
    <article
      className={['lane', accent, focused ? 'focus' : '', mini ? 'mini' : ''].filter(Boolean).join(' ')}
      style={gridArea ? { gridArea } : undefined}
      data-inc={inc.id}
      tabIndex={0}
      role="button"
      aria-pressed={focused}
      aria-label={`Lane ${letter} · ${alert.title} · ${focused ? 'focused' : 'unattended'}`}
      onClick={onLaneClick}
      onKeyDown={onLaneKey}
    >
      <div className="lane-h">
        <span className="lane-key" title={`Focus — key ${letter}`}>{letter}</span>
        <b className="lane-site">{shortSite(site?.name ?? inc.siteId)}</b>
        <span className="lane-age mono">Open {fmtClock(age)}</span>
        <span
          className={`owner ${focused ? 'mine' : 'auto'}`}
          title={`Attended ${fmtClock(att)} · Unattended ${fmtClock(unatt)}`}
        >
          {focused ? 'You' : 'Unattended'}
        </span>
      </div>

      <div className="lfeed">
        <VideoSlot cameraId={inc.cameraId} tier={focused ? 'full' : 'sub'} />
        {alert.confidence !== null && (
          <div className="bbox">
            <b>Person {alert.confidence.toFixed(2)}</b>
          </div>
        )}
        <div className="osd tl">
          <span className="tag rec">● REC</span>
          <span className="tag mono">CAM {inc.cameraId}</span>
        </div>
        <div className="osd br">
          <span className="tag mono">{focused ? 'Full · 4K' : 'Sub · 720p'}</span>
        </div>
      </div>

      <div className="lane-b">
        <h3>{alert.title}</h3>
        <div className="chips">
          {alert.chips.map((c, i) => (
            <span key={c} className={`chip ${i === 0 ? 'hot' : ''}`}>{c}</span>
          ))}
          {watch?.band === 'hi' && (
            <span className="chip crit">Watch {watch.score} {watch.trend > 0 ? '+' : ''}{watch.trend}</span>
          )}
        </div>

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

        <div className="ev">
          <span className="ev-l">Evidence</span>
          {thumbs.length ? (
            thumbs.map((e, ix) => (
              <span key={e.id} className={`thumb ${ix === 0 ? 'new' : ''}`} title={e.description}>
                <i>{e.capturedAt.slice(11, 16)}</i>
              </span>
            ))
          ) : (
            <span className="capturing">capturing…</span>
          )}
          <span className="ev-n">{plural(allEvidence.length, 'still')}</span>
        </div>

        <div className="lane-acts">
          <div className="acts-group">
            <button className="btn ai" aria-pressed={micOn} onClick={() => void store.toggleMic(inc.id)}>
              {micOn ? 'On air — end' : 'Two-way talk'}
            </button>
            <button className="btn crit" aria-pressed={inc.siren} onClick={() => void store.setSiren(inc.id, !inc.siren)}>
              {inc.siren ? 'Siren on' : 'Siren'}
            </button>
            <button className="btn" aria-pressed={inc.strobe} onClick={() => void store.setStrobe(inc.id, !inc.strobe)}>
              {inc.strobe ? 'Strobe active' : 'Strobe'}
            </button>
          </div>
          <div className="acts-divider" aria-hidden="true" />
          <div className="acts-group">
            <button className="btn resolve" onClick={() => store.openCloseout(inc.id)}>Close incident</button>
          </div>
        </div>
      </div>
    </article>
  )
}
