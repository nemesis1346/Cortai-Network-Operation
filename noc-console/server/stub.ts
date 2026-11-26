/**
 * Stub server: one MockNocClient behind the real endpoints of
 * docs/API-CONTRACT.md §2, so the app can run end to end over the wire
 * (VITE_NOC_API=http) before a real backend exists.
 *
 *   npm run stub            # http://localhost:8787, WebSocket at /api/events
 *   npm run dev:http        # the app, proxied to it by vite.config.ts
 *
 * It's a stand-in, not a backend: all state lives in memory in one mock
 * instance shared by every connection, and restarting it starts a fresh
 * shift. What it does implement for real is the transport contract the HTTP
 * client depends on: the Result<T> body and status codes (§2a), session
 * cookies and the socket's auth on upgrade (§2e), and idempotency replay
 * for take/close (§6).
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { MockNocClient } from '../src/api/mock/MockNocClient.ts'
import type { ErrorCode, NextStepId, Result } from '../src/api/types.ts'
import type { QueuePriority } from '../src/domain/rules.ts'

/** §2a: HTTP status per error code. The client branches on `error.code`. */
export const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  LANE_LIMIT: 409,
  MIC_BUSY: 409,
  MEMO_TOO_SHORT: 422,
  INVALID_CODE: 422,
  CODE_EXPIRED: 422,
  EMAIL_LOCKED: 423,
  RATE_LIMITED: 429,
  RESEND_TOO_SOON: 429,
  UNAUTHENTICATED: 401,
  BAD_REQUEST: 400,
  NETWORK_ERROR: 503, // never sent by a server: the client's own "no response" code
}

const IDEMPOTENCY_TTL_MS = 5 * 60_000 // §6
const PENDING_TTL_MS = 10 * 60_000 // §2e: same window as the code itself
const SESSION_CLOSE_CODE = 4401 // §2e: socket closed because the session ended

type Json = Record<string, unknown>
type SessionKind = 'pending' | 'active'

/**
 * Session tokens are signed, not looked up, so they survive a stub restart:
 * Yassine's point 3 is done when stopping and restarting the stub shows the
 * banner and then resyncs *without a page reload*, which an in-memory session
 * table would make impossible (the browser's cookie would be unknown to the
 * new process). Token: `<kind>.<expiresAtMs or 0>.<nonce>.<hmac>`.
 * The secret is a fixed dev value on purpose: this is a local stub, never a
 * deployment. A real backend issues and stores its own sessions.
 */
const SECRET = process.env.NOC_STUB_SECRET ?? 'noc-stub-dev-only'
const sign = (payload: string) => createHmac('sha256', SECRET).update(payload).digest('base64url')
const issue = (kind: SessionKind, ttlMs: number | null): string => {
  const payload = `${kind}.${ttlMs === null ? 0 : Date.now() + ttlMs}.${randomUUID()}`
  return `${payload}.${sign(payload)}`
}
type Handler = (ctx: {
  body: Json
  params: string[]
  cookies: Record<string, string>
  /** The `noc_session` cookie, if any. */
  token: string | null
  res: ServerResponse
}) => Promise<Result<unknown>>

interface Route {
  method: 'GET' | 'POST'
  pattern: RegExp
  /** 'none': open; 'pending': needs a verified code (desk pick); 'active': a signed-in session. */
  auth: 'none' | 'pending' | 'active'
  idempotent?: boolean
  handler: Handler
}

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } })

export interface StubOptions {
  port?: number
  /** Start the mock's 1s ticker (ladder, evidence, auto-page). Tests turn it off. */
  tick?: boolean
  log?: boolean
}

export interface Stub {
  port: number
  mock: MockNocClient
  close(): Promise<void>
}

export async function startStub({ port = 8787, tick = true, log = false }: StubOptions = {}): Promise<Stub> {
  // NOC_GO2RTC_URL: same as the browser mock's VITE_GO2RTC_URL (video/README.md).
  const mock = new MockNocClient({ go2rtcUrl: process.env.NOC_GO2RTC_URL })
  /** Signed-out tokens, so a copied cookie can't outlive its sign-out. In
   * memory only: a restart forgets them, acceptable for a local stub. */
  const revoked = new Set<string>()
  const replay = new Map<string, { at: number; status: number; body: string }>()
  const sockets = new Map<WebSocket, string>()

  const sessionFor = (token: string | null, kind: SessionKind): boolean => {
    if (!token || revoked.has(token)) return false
    const i = token.lastIndexOf('.')
    if (i < 0) return false
    const payload = token.slice(0, i)
    const given = Buffer.from(token.slice(i + 1))
    const expected = Buffer.from(sign(payload))
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
    const [k, exp] = payload.split('.')
    if (k !== kind) return false
    return exp === '0' || Number(exp) > Date.now()
  }

  const setCookie = (res: ServerResponse, name: string, value: string, maxAgeSec: number | null) => {
    const age = maxAgeSec === null ? '' : `; Max-Age=${maxAgeSec}`
    // Secure is left off: the stub serves plain http on localhost. A real
    // backend must set it (§2e).
    res.appendHeader('Set-Cookie', `${name}=${value}; HttpOnly; SameSite=Strict; Path=/api${age}`)
  }

  const str = (b: Json, k: string): string | null => (typeof b[k] === 'string' ? (b[k] as string) : null)

  const routes: Route[] = [
    /* ---------- §2b session and auth ---------- */
    {
      method: 'POST', pattern: /^\/api\/auth\/code$/, auth: 'none',
      handler: async ({ body }) => {
        const email = str(body, 'email')
        return email ? mock.requestCode(email) : fail('BAD_REQUEST', 'email is required')
      },
    },
    {
      method: 'POST', pattern: /^\/api\/auth\/verify$/, auth: 'none',
      handler: async ({ body, res }) => {
        const email = str(body, 'email')
        const code = str(body, 'code')
        if (!email || !code) return fail('BAD_REQUEST', 'email and code are required')
        const r = await mock.verifyCode(email, code)
        if (r.ok) {
          setCookie(res, 'noc_pending', issue('pending', PENDING_TTL_MS), PENDING_TTL_MS / 1000)
        }
        return r
      },
    },
    {
      method: 'POST', pattern: /^\/api\/auth\/desk$/, auth: 'none',
      handler: async ({ body, res, cookies }) => {
        if (typeof body.deskId !== 'number') return fail('BAD_REQUEST', 'deskId must be a number')
        const pending = cookies.noc_pending ?? null
        if (!sessionFor(pending, 'pending')) return fail('INVALID_STATE', 'Verify a code before choosing a desk')
        const r = await mock.selectDesk(body.deskId)
        if (r.ok) {
          revoked.add(pending!)
          setCookie(res, 'noc_pending', '', 0)
          setCookie(res, 'noc_session', issue('active', null), null)
        }
        return r
      },
    },
    {
      method: 'POST', pattern: /^\/api\/auth\/lock$/, auth: 'none',
      // Checked against the cookie, not mock.lock(): after a stub restart the
      // mock has no session of its own, but the signed cookie is still valid.
      // Locking changes nothing server-side either way (§2b).
      handler: async ({ token }) =>
        sessionFor(token, 'active') ? { ok: true, value: null } : fail('INVALID_STATE', 'No active session to lock'),
    },
    {
      method: 'POST', pattern: /^\/api\/auth\/sign-out$/, auth: 'none',
      handler: async ({ token, res }) => {
        if (token) {
          revoked.add(token)
          for (const [ws, t] of sockets) if (t === token) ws.close(SESSION_CLOSE_CODE, 'Signed out')
        }
        setCookie(res, 'noc_session', '', 0)
        setCookie(res, 'noc_pending', '', 0)
        return mock.signOut()
      },
    },

    /* ---------- §2c state and records ---------- */
    {
      method: 'GET', pattern: /^\/api\/snapshot$/, auth: 'active',
      handler: async () => ({ ok: true, value: await mock.getSnapshot() }),
    },
    {
      method: 'GET', pattern: /^\/api\/incidents\/([^/]+)\/record$/, auth: 'active',
      handler: async ({ params }) => mock.getRecord(params[0]!),
    },

    /* ---------- §2d commands ---------- */
    {
      method: 'POST', pattern: /^\/api\/incidents$/, auth: 'active', idempotent: true,
      handler: async ({ body }) => {
        const alertId = str(body, 'alertId')
        return alertId ? mock.openIncident(alertId) : fail('BAD_REQUEST', 'alertId is required')
      },
    },
    {
      method: 'POST', pattern: /^\/api\/incidents\/raise$/, auth: 'active',
      handler: async ({ body }) => {
        const cameraId = str(body, 'cameraId')
        const priority = str(body, 'priority')
        if (!cameraId || !priority || !['P1', 'P2', 'P3', 'P4'].includes(priority)) {
          return fail('BAD_REQUEST', 'cameraId and priority (P1-P4) are required')
        }
        return mock.raiseIncident(cameraId, priority as QueuePriority)
      },
    },
    {
      method: 'POST', pattern: /^\/api\/alerts\/([^/]+)\/hold$/, auth: 'active',
      handler: async ({ params }) => mock.holdAlert(params[0]!),
    },
    {
      method: 'POST', pattern: /^\/api\/incidents\/([^/]+)\/close$/, auth: 'active', idempotent: true,
      handler: async ({ params, body }) => {
        const memo = str(body, 'memo')
        if (memo === null || !Array.isArray(body.nextSteps)) return fail('BAD_REQUEST', 'memo and nextSteps are required')
        return mock.closeIncident(params[0]!, { memo, nextSteps: body.nextSteps as NextStepId[] })
      },
    },
    {
      method: 'POST', pattern: /^\/api\/focus$/, auth: 'active',
      handler: async ({ body }) => {
        if (!('incidentId' in body) || (body.incidentId !== null && typeof body.incidentId !== 'string')) {
          return fail('BAD_REQUEST', 'incidentId must be a string or null')
        }
        return mock.setFocus(body.incidentId as string | null)
      },
    },
    {
      method: 'POST', pattern: /^\/api\/mic$/, auth: 'active',
      handler: async ({ body }) => {
        if (!('incidentId' in body) || (body.incidentId !== null && typeof body.incidentId !== 'string')) {
          return fail('BAD_REQUEST', 'incidentId must be a string or null')
        }
        return mock.bindMic(body.incidentId as string | null, { force: body.force === true })
      },
    },
    ...(
      [
        ['ladder/halt', (id: string) => mock.haltLadder(id)],
        ['ladder/resume', (id: string) => mock.resumeLadder(id)],
        ['dispatch', (id: string) => mock.confirmDispatch(id)],
        ['escalation/ack', (id: string) => mock.acknowledgeEscalation(id)],
      ] as const
    ).map(([path, run]): Route => ({
      method: 'POST', pattern: new RegExp(`^/api/incidents/([^/]+)/${path}$`), auth: 'active',
      handler: async ({ params }) => run(params[0]!),
    })),
    ...(['siren', 'strobe'] as const).map((kind): Route => ({
      method: 'POST', pattern: new RegExp(`^/api/incidents/([^/]+)/${kind}$`), auth: 'active',
      handler: async ({ params, body }) => {
        if (typeof body.on !== 'boolean') return fail('BAD_REQUEST', 'on must be a boolean')
        return kind === 'siren' ? mock.setSiren(params[0]!, body.on) : mock.setStrobe(params[0]!, body.on)
      },
    })),
    {
      method: 'POST', pattern: /^\/api\/incidents\/([^/]+)\/notes$/, auth: 'active',
      handler: async ({ params, body }) => {
        const text = str(body, 'text')
        return text === null ? fail('BAD_REQUEST', 'text is required') : mock.addNote(params[0]!, text)
      },
    },
    {
      method: 'POST', pattern: /^\/api\/pages$/, auth: 'active',
      handler: async ({ body }) => {
        const reason = str(body, 'reason')
        return reason === null ? fail('BAD_REQUEST', 'reason is required') : mock.requestDeskPage(reason)
      },
    },
    {
      method: 'POST', pattern: /^\/api\/pages\/(\d+)\/ack$/, auth: 'active',
      handler: async ({ params }) => mock.acknowledgePage(Number(params[0])),
    },
  ]

  const send = (res: ServerResponse, status: number, body: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(body)
  }
  const sendResult = (res: ServerResponse, r: Result<unknown>): { status: number; body: string } => {
    const status = r.ok ? 200 : STATUS[r.error.code]
    if (!r.ok && r.error.retryAfterSec !== undefined) res.setHeader('Retry-After', String(r.error.retryAfterSec))
    const body = JSON.stringify(r)
    send(res, status, body)
    return { status, body }
  }

  const readBody = (req: IncomingMessage): Promise<Json | null> =>
    new Promise((resolve) => {
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (c: string) => (raw += c))
      req.on('end', () => {
        if (!raw.trim()) return resolve({})
        try {
          const v: unknown = JSON.parse(raw)
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
        } catch {
          resolve(null)
        }
      })
    })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies.noc_session ?? null
    const started = Date.now()
    const done = (status: number) => log && console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`)

    let params: string[] = []
    const route = routes.find((r) => {
      if (r.method !== req.method) return false
      const m = r.pattern.exec(url.pathname)
      if (m) params = m.slice(1).map(decodeURIComponent)
      return !!m
    })
    if (!route) {
      const r = fail('NOT_FOUND', `No endpoint ${req.method} ${url.pathname}`)
      done(sendResult(res, r).status)
      return
    }
    if (route.auth === 'active' && !sessionFor(token, 'active')) {
      done(sendResult(res, fail('UNAUTHENTICATED', 'Sign in to continue.')).status)
      return
    }
    const body = req.method === 'POST' ? await readBody(req) : {}
    if (body === null) {
      done(sendResult(res, fail('BAD_REQUEST', 'Body must be a JSON object')).status)
      return
    }

    // §6: replay, not re-execute, a repeat of the same take/close.
    const key = route.idempotent ? req.headers['idempotency-key'] : undefined
    const replayKey = typeof key === 'string' ? `${req.method} ${url.pathname} ${key}` : null
    if (replayKey) {
      const now = Date.now()
      for (const [k, v] of replay) if (now - v.at > IDEMPOTENCY_TTL_MS) replay.delete(k)
      const hit = replay.get(replayKey)
      if (hit) {
        res.setHeader('Idempotent-Replayed', 'true')
        send(res, hit.status, hit.body)
        done(hit.status)
        return
      }
    }

    let r: Result<unknown>
    try {
      r = await route.handler({ body, params, cookies, token, res })
    } catch (e) {
      console.error(e)
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal error')
      done(500)
      return
    }
    const sent = sendResult(res, r)
    if (replayKey) replay.set(replayKey, { at: Date.now(), ...sent })
    done(sent.status)
  })

  // §2e: the socket authenticates on the upgrade request, with the same cookie.
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const token = parseCookies(req.headers.cookie).noc_session ?? null
    if (url.pathname !== '/api/events' || !sessionFor(token, 'active')) {
      socket.end(`HTTP/1.1 ${url.pathname === '/api/events' ? '401 Unauthorized' : '404 Not Found'}\r\nConnection: close\r\n\r\n`)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, token!)
      ws.on('close', () => sockets.delete(ws))
    })
  })
  const unsubscribe = mock.subscribe((e) => {
    const msg = JSON.stringify(e)
    for (const ws of sockets.keys()) if (ws.readyState === ws.OPEN) ws.send(msg)
  })

  if (tick) mock.start()
  await new Promise<void>((resolve) => server.listen(port, resolve))
  const actualPort = (server.address() as AddressInfo).port
  if (log) console.log(`NOC stub listening on http://localhost:${actualPort} (WebSocket /api/events)`)

  return {
    port: actualPort,
    mock,
    close: () =>
      new Promise<void>((resolve) => {
        mock.stop()
        unsubscribe()
        for (const ws of sockets.keys()) ws.terminate()
        wss.close()
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of header?.split(';') ?? []) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.NOC_STUB_PORT ?? 8787)
  void startStub({ port, log: true })
}
