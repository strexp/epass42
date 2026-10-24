/**
 * Part 2 harness — boots the real backend (same `buildApp` the entrypoint uses)
 * on an ephemeral port and talks to it over real HTTP.
 *
 * The only test double is the OIDC driver: a fake identity provider lets the
 * suite complete `/auth/{realm}/login` without a network round-trip.  SQLite,
 * signing, sessions, cookies and routing are the production code paths.
 *
 * Besides the HTTP client, the harness exposes the built app and its raw SQLite
 * handle so lifecycle tests can move a certificate's stored `not_after` into the
 * past (the expiry gates read that column, not the certificate bytes).
 */
import type { AddressInfo } from 'node:net'

import { mergeConfig, type RawConfig } from '../../../backend/src/config'
import { currentCscaKey, currentNiaDsc } from '../../../backend/src/modules/csca/service'
import type { MntResolver } from '../../../backend/src/modules/jurisdiction/whois'
import { currentCvcaKey, currentDefaultDv } from '../../../backend/src/modules/cvca/service'
import { FakeOidc, makeTestApp, staticMntResolver } from '../../../backend/src/test-support'

export { staticMntResolver } from '../../../backend/src/test-support'

/** A minimal response wrapper with both text and binary access. */
export interface HttpResponse {
  status: number
  headers: Headers
  text: string
  bytes: Uint8Array
  location: string | null
  json<T = Record<string, unknown>>(): T
}

/** HTTP client with a cookie jar, so realm sessions survive across requests. */
export class HttpClient {
  private readonly cookies = new Map<string, string>()

  constructor(private readonly baseUrl: string) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  private captureCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0] ?? ''
      const separator = pair.indexOf('=')
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
      }
    }
  }

  async request(path: string, init: RequestInit = {}): Promise<HttpResponse> {
    const headers = new Headers(init.headers)
    const cookie = this.cookieHeader()
    if (cookie) headers.set('cookie', cookie)
    if (typeof init.body === 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    })
    this.captureCookies(response)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      status: response.status,
      headers: response.headers,
      text: new TextDecoder().decode(bytes),
      bytes,
      location: response.headers.get('location'),
      json: <T = Record<string, unknown>>() => JSON.parse(new TextDecoder().decode(bytes)) as T,
    }
  }

  get(path: string): Promise<HttpResponse> {
    return this.request(path)
  }

  post(path: string, payload?: unknown, init: RequestInit = {}): Promise<HttpResponse> {
    return this.request(path, {
      ...init,
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  }

  put(path: string, payload?: unknown, init: RequestInit = {}): Promise<HttpResponse> {
    return this.request(path, {
      ...init,
      method: 'PUT',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  }

  delete(path: string, init: RequestInit = {}): Promise<HttpResponse> {
    return this.request(path, { ...init, method: 'DELETE' })
  }
}

/** A row returned by a raw SQLite helper query. */
export type SqlRow = Record<string, unknown>

/** A running backend instance. */
export interface Backend {
  base: string
  /** The shared cookie jar; one session set per realm. */
  client: HttpClient
  oidc: FakeOidc
  /** The built application (services, config, database). */
  built: Awaited<ReturnType<typeof makeTestApp>>
  config: Awaited<ReturnType<typeof makeTestApp>>['config']
  /** A fresh client with its own cookie jar (session isolation tests). */
  createClient(): HttpClient
  /** The live CSCA certificate (PEM), read from the bootstrapped key. */
  cscaPem(): string
  /** The live CVCA certificate (DER), read from the bootstrapped key. */
  cvcaDer(): Uint8Array
  /** The active NIA DSC, default DV or ML signer row, for lifecycle setup. */
  niaDsc(): ReturnType<typeof currentNiaDsc>
  defaultDv(): ReturnType<typeof currentDefaultDv>
  /** Runs a write statement against the in-memory SQLite database. */
  sql(statement: string, ...params: unknown[]): { changes: number }
  /** Runs a read statement against the in-memory SQLite database. */
  query<T extends SqlRow = SqlRow>(statement: string, ...params: unknown[]): T[]
  close(): Promise<void>
}

/** Options for {@link startBackend}. */
export interface StartBackendOptions {
  /** Override the IP → maintainer resolver (defaults to an empty static one). */
  mntResolver?: MntResolver
  /** Enable the Fastify logger (useful when debugging a failing scenario). */
  logger?: boolean
}

/**
 * Boots the backend on a random loopback port with a bootstrapped CSCA and a
 * raised rate limit (individual suites lower it when they test throttling).
 */
export async function startBackend(
  overrides: RawConfig = {},
  options: StartBackendOptions = {},
): Promise<Backend> {
  const oidc = new FakeOidc()
  const raw = mergeConfig(
    {
      csca: { bootstrap: true },
      cvca: { bootstrap: true },
      rateLimit: { max: 100_000, windowMs: 60_000 },
    },
    overrides,
  )
  const built = await makeTestApp(
    oidc,
    raw,
    options.mntResolver ?? staticMntResolver(),
    options.logger ?? false,
  )
  await built.app.listen({ host: '127.0.0.1', port: 0 })
  const address = built.app.server.address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  return {
    base,
    client: new HttpClient(base),
    oidc,
    built,
    config: built.config,
    createClient: () => new HttpClient(base),
    cscaPem(): string {
      const key = currentCscaKey(built.dbHandle.db)
      if (!key?.certPem) throw new Error('backend bootstrapped no CSCA certificate')
      return key.certPem
    },
    cvcaDer(): Uint8Array {
      const key = currentCvcaKey(built.dbHandle.db)
      if (!key?.certDer) throw new Error('backend bootstrapped no CVCA certificate')
      return new Uint8Array(key.certDer)
    },
    niaDsc: () => currentNiaDsc(built.dbHandle.db),
    defaultDv: () => currentDefaultDv(built.dbHandle.db),
    sql(statement: string, ...params: unknown[]): { changes: number } {
      const result = built.dbHandle.sqlite.prepare(statement).run(...params)
      return { changes: Number(result.changes) }
    },
    query<T extends SqlRow = SqlRow>(statement: string, ...params: unknown[]): T[] {
      return built.dbHandle.sqlite.prepare(statement).all(...params) as T[]
    },
    close: () => built.app.close(),
  }
}

/** Runs `fn` against a freshly booted backend and always closes it. */
export async function withBackend<T>(
  fn: (backend: Backend) => Promise<T>,
  overrides: RawConfig = {},
  options: StartBackendOptions = {},
): Promise<T> {
  const backend = await startBackend(overrides, options)
  try {
    return await fn(backend)
  } finally {
    await backend.close()
  }
}

/** The identity information returned by `/auth/{realm}/me`. */
export interface SessionInfo {
  csrf: string
  isAdmin: boolean
  reviewScope: string
  account: {
    id: number
    realm: string
    activeMnt: string | null
    email: string | null
    name: string | null
  }
  prefill: Record<string, unknown>
}

/**
 * Completes the fake OIDC login flow for a realm, storing its session cookie,
 * and returns the server's view of the session.
 */
export async function loginAs(
  backend: Backend,
  realm: 'csca' | 'cvca' | 'dv' | 'dsc' | 'ml',
  clientId: string,
  claims: Record<string, unknown>,
  client: HttpClient = backend.client,
): Promise<SessionInfo> {
  backend.oidc.set(clientId, { subject: String(claims.sub), claims })

  const start = await client.get(`/auth/${realm}/login`)
  if (start.status !== 302 || !start.location) {
    throw new Error(`login for ${realm} did not redirect (${start.status})`)
  }
  const state = new URL(start.location).searchParams.get('state')
  if (!state) throw new Error(`login for ${realm} returned no state`)

  const callback = await client.get(
    `/auth/${realm}/callback?code=e2e&state=${encodeURIComponent(state)}`,
  )
  if (callback.status !== 302) {
    throw new Error(`callback for ${realm} failed (${callback.status}: ${callback.text})`)
  }

  const me = await client.get(`/auth/${realm}/me`)
  if (me.status !== 200) throw new Error(`/auth/${realm}/me failed (${me.status}: ${me.text})`)
  return me.json<SessionInfo>()
}

/** Logs out of a realm, optionally omitting the CSRF header (negative tests). */
export async function logoutAs(
  backend: Backend,
  realm: 'csca' | 'cvca' | 'dv' | 'dsc' | 'ml',
  csrf?: string,
  client: HttpClient = backend.client,
): Promise<HttpResponse> {
  const headers: Record<string, string> = {}
  if (csrf !== undefined) headers['x-csrf-token'] = csrf
  return client.post(`/auth/${realm}/logout`, undefined, { headers })
}
