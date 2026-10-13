import type { Incident, Snapshot, TranscriptSpeaker } from '../api/types'
import { laneLetter } from '../domain/rules'
import { useStore } from '../store/context'

const SPEAKER_LABEL: Record<TranscriptSpeaker, string> = { sys: 'System', ai: 'AI', op: 'Operator' }

/**
 * v2 COMPONENTS.md#CommsDock: mic binding, speaker level, last transcript
 * line, "Move mic here (M)" — inside the focused lane now, not a global
 * footer (v2 deviations#5). `onOpenTranscript` switches the watch column to
 * its Transcript tab rather than opening anything separate, since the full
 * transcript is that tab now.
 */
export function CommsDock({ inc, server, onOpenTranscript }: { inc: Incident; server: Snapshot; onOpenTranscript: () => void }) {
  const store = useStore()
  const micOn = server.micOwnerIncidentId === inc.id
  const micOwnerInc = !micOn && server.micOwnerIncidentId
    ? server.incidents.find((i) => i.id === server.micOwnerIncidentId)
    : null
  const lastLine = [...server.transcript].reverse().find((l) => l.incidentId === inc.id) ?? null

  return (
    <div className="comms-dock">
      <div className="cd-row">
        <span className={`speaker-dot ${server.speaker.mode}`} aria-hidden="true" />
        <div className={`wave ${server.speaker.mode !== 'idle' ? 'on' : ''}`} aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
        {micOn ? (
          <b>Mic open to this lane</b>
        ) : (
          <>
            <span className={micOwnerInc ? '' : 'dim'}>
              {micOwnerInc ? `Mic open to Lane ${laneLetter(micOwnerInc)}` : 'Mic unbound'}
            </span>
            <button className="btn sm cd-move" onClick={() => void store.toggleMic(inc.id)}>
              Move mic here <kbd>M</kbd>
            </button>
          </>
        )}
      </div>
      {lastLine && (
        <button className="cd-last" onClick={onOpenTranscript}>
          <span className="who">{SPEAKER_LABEL[lastLine.speaker]}</span>
          <span className="tx">{lastLine.text}</span>
        </button>
      )}
    </div>
  )
}
