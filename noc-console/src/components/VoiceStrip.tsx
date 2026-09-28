import { useEffect, useRef, useState } from 'react'
import type { Snapshot, TranscriptSpeaker } from '../api/types'
import { laneLetter } from '../domain/rules'

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = { sys: 'System', ai: 'AI', op: 'Operator' }
const AUTO_FOLLOW_THRESHOLD = 32

/**
 * Speaker state, mic binding and the transcript. No ladder mini-status here —
 * the audit (A9) found it duplicated each lane's own ladder row under a
 * different vocabulary ("Complete" vs "Siren done, no operator" for the same
 * state) and told us to drop it, keeping .lstage as the one place that fact
 * lives. That's a deliberate divergence from the brief's screen list, agreed
 * with Yassine when the audit was approved.
 */
export function VoiceStripBody({ server }: { server: Snapshot }) {
  const listRef = useRef<HTMLDivElement>(null)
  const [autoFollow, setAutoFollow] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = listRef.current
    if (!el || !autoFollow) return
    el.scrollTop = el.scrollHeight
  }, [server.transcript.length, autoFollow, expanded])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoFollow(fromBottom <= AUTO_FOLLOW_THRESHOLD)
  }

  const micInc = server.incidents.find((i) => i.id === server.micOwnerIncidentId) ?? null
  const micSite = micInc ? server.sites.find((s) => s.id === micInc.siteId) : null

  return (
    <div className="voice-strip">
      <div className="vs-speaker">
        <span className={`speaker-dot ${server.speaker.mode}`} aria-hidden="true" />
        <div>
          <u>Speaker</u>
          <b>{server.speaker.label}</b>
        </div>
        <div className={`wave ${server.speaker.mode !== 'idle' ? 'on' : ''}`} aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
      </div>

      <div className="vs-mic">
        <u>Microphone</u>
        {micInc ? (
          <b>Bound to lane {laneLetter(micInc)} · {micSite?.name ?? micInc.siteId}</b>
        ) : (
          <b className="dim">Mic unbound</b>
        )}
      </div>

      <div className="vs-transcript">
        <div className="vs-transcript-head">
          <u>Transcript</u>
          <button className="btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        <div
          className={`transcript ${expanded ? 'expanded' : ''}`}
          ref={listRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
        >
          {server.transcript.map((l) => {
            const inc = l.incidentId ? server.incidents.find((i) => i.id === l.incidentId) : null
            return (
              <div className={`tline ${l.speaker}`} key={l.id}>
                <span className="ts mono">{l.at.slice(11, 19)}</span>
                <span className="who">{inc ? `${laneLetter(inc)}·` : ''}{SPEAKER_LABEL[l.speaker]}</span>
                <span className="tx">{l.text}</span>
              </div>
            )
          })}
        </div>
        {!autoFollow && (
          <button
            className="jump-latest"
            onClick={() => {
              setAutoFollow(true)
              if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
            }}
          >
            Jump to latest
          </button>
        )}
      </div>
    </div>
  )
}
