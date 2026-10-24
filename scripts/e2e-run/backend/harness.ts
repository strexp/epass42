/**
 * Part 2 harness — boots the real backend (same `buildApp` the entrypoint uses)
 * on an ephemeral port and talks to it over real HTTP.
 *
 * The only test double is the OIDC driver: a fake identity provider lets the
 * suite complete `/auth/{realm}/login` without a network round-trip.  SQLite,
 * signing, sessions, cookies and routing are the production code paths.
 */
import type { AddressInfo } from 'node:net'

import { FakeOidc, makeTestApp } from '../../../backend/src/test-support'
import { currentCscaKey } from '../../../backend/src/modules/csca/service'
import type { RawConfig } from '../../../backend/src/config'

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

  post(path: string, payload?: unknown): Promise<HttpResponse> {
    return this.request(path, {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  }
}

/** A running backend instance. */
export interface Backend {
  base: string
  client: HttpClient
  oidc: FakeOidc
  /** The live CSCA certificate (PEM), read from the bootstrapped key. */
  cscaPem(): string
  close(): Promise<void>
}

/** Boots the backend on a random loopback port with a bootstrapped CSCA. */
export async function startBackend(overrides: RawConfig = {}): Promise<Backend> {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { csca: { bootstrap: true }, ...overrides })
  await built.app.listen({ host: '127.0.0.1', port: 0 })
  const address = built.app.server.address() as AddressInfo
  return {
    base: `http://127.0.0.1:${address.port}`,
    client: new HttpClient(`http://127.0.0.1:${address.port}`),
    oidc,
    cscaPem(): string {
      const key = currentCscaKey(built.dbHandle.db)
      if (!key?.certPem) throw new Error('backend bootstrapped no CSCA certificate')
      return key.certPem
    },
    close: () => built.app.close(),
  }
}

/** Completes the fake OIDC login flow for a realm, storing its session cookie. */
export async function loginAs(
  backend: Backend,
  realm: 'csca' | 'cvca' | 'dv' | 'dsc' | 'ml',
  clientId: string,
  claims: Record<string, unknown>,
): Promise<void> {
  backend.oidc.set(clientId, { subject: String(claims.sub), claims })

  const start = await backend.client.get(`/auth/${realm}/login`)
  if (start.status !== 302 || !start.location) {
    throw new Error(`login for ${realm} did not redirect (${start.status})`)
  }
  const state = new URL(start.location).searchParams.get('state')
  if (!state) throw new Error(`login for ${realm} returned no state`)

  const callback = await backend.client.get(
    `/auth/${realm}/callback?code=e2e&state=${encodeURIComponent(state)}`,
  )
  if (callback.status !== 302) {
    throw new Error(`callback for ${realm} failed (${callback.status}: ${callback.text})`)
  }
}
