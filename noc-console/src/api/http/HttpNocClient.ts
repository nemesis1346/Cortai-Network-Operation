import type { NocClient } from '../client'
import type { QueuePriority } from '../../domain/rules'
import type {
  AuthOperator,
  CloseIncidentInput,
  ErrorCode,
  Incident,
  IncidentReport,
  Result,
  ServerEvent,
  Snapshot,
} from '../types'

/** The subset of the browser WebSocket this client uses, so tests can hand
 * in `ws`'s client (which, unlike Node's built-in one, can send a cookie). */
export interface SocketLike {
  readonly readyState: number
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(code?: number, reason?: string): void
}

export interface HttpNocClientOptions {
  /** REST base. Default '/api' (same origin; vite.config.ts proxies it in dev). */
  baseUrl?: string
  /** Event socket URL. Default: ws(s)://<this host>/api/events. */
  eventsUrl?: string
  fetch?: typeof fetch
  createSocket?: (url: string) => SocketLike
  /** Reconnect backoff: starts here, doubles per failed attempt, capped at maxMs. */
  reconnect?: { minMs: number; maxMs: number }
  /** Waits between attempts when take/close gets no response. Same Idempotency-Key each time. */
  retryDelaysMs?: number[]
}

/** API-CONTRACT.md §2e: the server closed the socket because the session ended. */
const SESSION_ENDED = 4401
const OPEN = 1

const networkError = (): Result<never> => ({
  ok: false,
  error: { code: 'NETWORK_ERROR', message: "Couldn't reach the server. Nothing was sent." },
})

/**
 * NocClient over REST + WebSocket, exactly as docs/API-CONTRACT.md §2
 * describes. Every response body is already a Result<T> (§2a), so commands
 * pass it straight through. Selected by VITE_NOC_API=http (main.tsx).
 *
 * Connection model: the event socket *is* the connection. It opens on the
 * first subscribe(), and when it drops the client reports 'offline' and
 * reconnects with backoff (0.5s doubling to 5s); when it's back it reports
 * 'online' and the store re-fetches the snapshot, which is how state missed
 * while offline gets resynced (§2c). An intentional close (unsubscribe, or
 * the server ending the session) doesn't reconnect.
 */
export class HttpNocClient implements NocClient {
  private readonly baseUrl: string
  private readonly eventsUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly createSocket: (url: string) => SocketLike
  private readonly backoff: { minMs: number; maxMs: number }
  private readonly retryDelaysMs: number[]

  private readonly listeners = new Set<(e: ServerEvent) => void>()
  private readonly connectionListeners = new Set<(s: 'online' | 'offline') => void>()
  private socket: SocketLike | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private reported: 'online' | 'offline' | null = null

  constructor(opts: HttpNocClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '/api'
    this.eventsUrl = opts.eventsUrl ?? defaultEventsUrl()
    this.fetchImpl = opts.fetch ?? ((...a) => globalThis.fetch(...a))
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike)
    this.backoff = opts.reconnect ?? { minMs: 500, maxMs: 5000 }
    this.retryDelaysMs = opts.retryDelaysMs ?? [400, 1200]
  }

  /* ---------- transport ---------- */

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers?: Record<string, string>): Promise<Result<T>> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        credentials: 'same-origin',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      return networkError()
    }
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      // A reply that isn't JSON came from something in between (a proxy with
      // the server down, a gateway), never from the API itself (§2a).
      return networkError()
    }
    if (isResult<T>(parsed)) return parsed
    return networkError()
  }

  /** take/close (§6): one key per user action, reused on every retry, so a
   * retry after a lost response is replayed by the server, never re-run. */
  private async idempotent<T>(path: string, body: unknown): Promise<Result<T>> {
    const headers = { 'Idempotency-Key': uuid() }
    let r = await this.request<T>('POST', path, body, headers)
    for (const wait of this.retryDelaysMs) {
      if (r.ok || r.error.code !== 'NETWORK_ERROR') break
      await sleep(wait)
      r = await this.request<T>('POST', path, body, headers)
    }
    return r
  }

  private post<T = null>(path: string, body?: unknown): Promise<Result<T>> {
    return this.request<T>('POST', path, body)
  }

  /* ---------- events + connection ---------- */

  subscribe(handler: (e: ServerEvent) => void): () => void {
    this.listeners.add(handler)
    if (this.listeners.size === 1) this.open()
    return () => {
      this.listeners.delete(handler)
      if (this.listeners.size === 0) this.shut()
    }
  }

  onConnectionChange(handler: (status: 'online' | 'offline') => void): () => void {
    this.connectionListeners.add(handler)
    return () => this.connectionListeners.delete(handler)
  }

  reconnectNow(): void {
    if (this.listeners.size === 0 || this.socket?.readyState === OPEN) return
    this.clearTimer()
    this.attempt = 0
    this.socket?.close()
    this.open()
  }

  private open(): void {
    this.clearTimer()
    const ws = this.createSocket(this.eventsUrl)
    this.socket = ws
    ws.onopen = () => {
      this.attempt = 0
      this.report('online')
    }
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      let e: ServerEvent
      try {
        e = JSON.parse(ev.data) as ServerEvent
      } catch {
        return
      }
      for (const l of this.listeners) l(e)
    }
    ws.onerror = () => {} // always followed by onclose, which handles it
    ws.onclose = (ev) => {
      if (this.socket !== ws) return // superseded by reconnectNow() or shut()
      this.socket = null
      this.report('offline')
      if (ev.code === SESSION_ENDED || this.listeners.size === 0) return
      const delay = Math.min(this.backoff.maxMs, this.backoff.minMs * 2 ** this.attempt++)
      this.reconnectTimer = setTimeout(() => this.open(), delay)
    }
  }

  private shut(): void {
    this.clearTimer()
    const ws = this.socket
    this.socket = null
    this.reported = null
    ws?.close(1000, 'Client unsubscribed')
  }

  private clearTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  /** Reports transitions only, so repeated failed reconnects stay one 'offline'. */
  private report(s: 'online' | 'offline'): void {
    if (this.reported === s) return
    this.reported = s
    for (const l of this.connectionListeners) l(s)
  }

  /* ---------- §2c state and records ---------- */

  async getSnapshot(): Promise<Snapshot> {
    const r = await this.request<Snapshot>('GET', '/snapshot')
    if (!r.ok) throw new HttpNocError(r.error.code, r.error.message)
    return r.value
  }

  getRecord(incidentId: string): Promise<Result<IncidentReport>> {
    return this.request('GET', `/incidents/${enc(incidentId)}/record`)
  }

  /* ---------- §2d commands ---------- */

  openIncident(alertId: string): Promise<Result<Incident>> {
    return this.idempotent('/incidents', { alertId })
  }
  raiseIncident(cameraId: string, priority: QueuePriority): Promise<Result<Incident>> {
    return this.post('/incidents/raise', { cameraId, priority })
  }
  holdAlert(alertId: string): Promise<Result<null>> {
    return this.post(`/alerts/${enc(alertId)}/hold`)
  }
  closeIncident(incidentId: string, input: CloseIncidentInput): Promise<Result<IncidentReport>> {
    return this.idempotent(`/incidents/${enc(incidentId)}/close`, input)
  }
  setFocus(incidentId: string | null): Promise<Result<null>> {
    return this.post('/focus', { incidentId })
  }
  bindMic(incidentId: string | null, opts?: { force?: boolean }): Promise<Result<null>> {
    return this.post('/mic', { incidentId, force: opts?.force ?? false })
  }
  haltLadder(incidentId: string): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/ladder/halt`)
  }
  resumeLadder(incidentId: string): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/ladder/resume`)
  }
  confirmDispatch(incidentId: string): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/dispatch`)
  }
  setSiren(incidentId: string, on: boolean): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/siren`, { on })
  }
  setStrobe(incidentId: string, on: boolean): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/strobe`, { on })
  }
  addNote(incidentId: string, text: string): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/notes`, { text })
  }
  acknowledgeEscalation(incidentId: string): Promise<Result<null>> {
    return this.post(`/incidents/${enc(incidentId)}/escalation/ack`)
  }
  requestDeskPage(reason: string): Promise<Result<null>> {
    return this.post('/pages', { reason })
  }
  acknowledgePage(desk: number): Promise<Result<null>> {
    return this.post(`/pages/${desk}/ack`)
  }

  /* ---------- §2b session and auth ---------- */

  requestCode(email: string): Promise<Result<{ resendAfterSec: number }>> {
    return this.post('/auth/code', { email })
  }
  verifyCode(email: string, code: string): Promise<Result<{ operator: AuthOperator }>> {
    return this.post('/auth/verify', { email, code })
  }
  selectDesk(deskId: number): Promise<Result<null>> {
    return this.post('/auth/desk', { deskId })
  }
  lock(): Promise<Result<null>> {
    return this.post('/auth/lock')
  }
  signOut(): Promise<Result<null>> {
    return this.post('/auth/sign-out')
  }
}

/** getSnapshot's failure: it returns a Snapshot, not a Result, so it throws. */
export class HttpNocError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'HttpNocError'
  }
}

function isResult<T>(v: unknown): v is Result<T> {
  if (!v || typeof v !== 'object') return false
  const o = v as { ok?: unknown; value?: unknown; error?: { code?: unknown } }
  return o.ok === true ? 'value' in o : o.ok === false && typeof o.error?.code === 'string'
}

function defaultEventsUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787/api/events'
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/events`
}

const enc = encodeURIComponent
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function uuid(): string {
  // randomUUID needs a secure context (https or localhost); fall back for a
  // plain-http LAN address, where it's undefined.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
