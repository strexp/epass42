import type { LightMyRequestResponse } from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BuiltApp } from '../../app'
import { FakeOidc, makeTestApp } from '../../test-support'

const CSCA_CLAIMS = {
  sub: 'csca-subject',
  email: 'csca-admin@example.net',
  name: 'CSCA Admin',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-CSCA-MNT',
    active_name: 'CSCA Admin',
    mnt_by: ['EXAMPLE-CSCA-MNT'],
    route: ['10.127.21.0/24'],
    route6: ['fd42:4242:2189::/48'],
  },
}

const DSC_CLAIMS = {
  sub: 'dsc-subject',
  email: 'user@example.net',
  name: 'DSC User',
  dn42: {
    asn: 4242420000,
    active_mnt: 'USER-MNT',
    active_name: 'DSC User',
    mnt_by: ['USER-MNT'],
  },
}

function cookieOf(response: LightMyRequestResponse, realm: 'csca' | 'dsc'): string {
  const cookie = response.cookies.find((entry) => entry.name === `pkd42_${realm}_sid`)
  if (!cookie) throw new Error(`no ${realm} session cookie`)
  return `${cookie.name}=${cookie.value}`
}

/** Runs login + callback for a realm and returns the session cookie. */
async function login(app: BuiltApp['app'], realm: 'csca' | 'dsc'): Promise<string> {
  const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
  expect(start.statusCode).toBe(302)
  const location = start.headers.location
  if (typeof location !== 'string') throw new Error('no redirect')
  const state = new URL(location).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/${realm}/callback?code=abc&state=${state}`,
  })
  expect(callback.statusCode).toBe(302)
  return cookieOf(callback, realm)
}

describe('M4 authentication', () => {
  let app: BuiltApp['app']

  beforeEach(async () => {
    const oidc = new FakeOidc()
    oidc.set('csca-client', { subject: CSCA_CLAIMS.sub, claims: CSCA_CLAIMS })
    oidc.set('dsc-client', { subject: DSC_CLAIMS.sub, claims: DSC_CLAIMS })
    app = (await makeTestApp(oidc)).app
  })

  it('completes a login and returns the account', async () => {
    const cookie = await login(app, 'csca')
    const me = await app.inject({ method: 'GET', url: '/auth/csca/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    const body = me.json()
    expect(body.account.asn).toBe(4242422189)
    expect(body.account.activeMnt).toBe('EXAMPLE-CSCA-MNT')
    expect(body.isAdmin).toBe(true)
    expect(body.csrf).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(body.prefill.asn).toBe(4242422189)
    expect(body.prefill.route).toEqual(['10.127.21.0/24'])
  })

  it('keeps the two realms isolated', async () => {
    const cscaCookie = await login(app, 'csca')
    const dscCookie = await login(app, 'dsc')

    // Both sessions can be active at once.
    const cscaMe = await app.inject({
      method: 'GET',
      url: '/auth/csca/me',
      headers: { cookie: cscaCookie },
    })
    const dscMe = await app.inject({
      method: 'GET',
      url: '/auth/dsc/me',
      headers: { cookie: dscCookie },
    })
    expect(cscaMe.statusCode).toBe(200)
    expect(dscMe.statusCode).toBe(200)
    expect(cscaMe.json().account.asn).toBe(4242422189)
    expect(dscMe.json().account.asn).toBe(4242420000)

    // A CSCA cookie cannot authenticate the DSC realm.
    const cross = await app.inject({
      method: 'GET',
      url: '/auth/dsc/me',
      headers: { cookie: cscaCookie },
    })
    expect(cross.statusCode).toBe(401)
  })

  it('enforces administrator MNTs', async () => {
    const cscaCookie = await login(app, 'csca')
    const dscCookie = await login(app, 'dsc')

    const cscaAdmin = await app.inject({
      method: 'GET',
      url: '/auth/csca/admin',
      headers: { cookie: cscaCookie },
    })
    expect(cscaAdmin.statusCode).toBe(200)

    // The DSC user is not in DSC_ADMIN_MNTS.
    const dscAdmin = await app.inject({
      method: 'GET',
      url: '/auth/dsc/admin',
      headers: { cookie: dscCookie },
    })
    expect(dscAdmin.statusCode).toBe(403)

    // Anonymous is unauthorized, not forbidden.
    const anon = await app.inject({ method: 'GET', url: '/auth/csca/admin' })
    expect(anon.statusCode).toBe(401)
  })

  it('requires a CSRF token to log out', async () => {
    const cookie = await login(app, 'csca')
    const me = await app.inject({ method: 'GET', url: '/auth/csca/me', headers: { cookie } })
    const csrf = me.json().csrf as string

    const missing = await app.inject({
      method: 'POST',
      url: '/auth/csca/logout',
      headers: { cookie },
    })
    expect(missing.statusCode).toBe(403)

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/csca/logout',
      headers: { cookie, 'x-csrf-token': csrf },
    })
    expect(ok.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: '/auth/csca/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('rejects an unknown or reused state', async () => {
    const callback = await app.inject({
      method: 'GET',
      url: '/auth/csca/callback?code=abc&state=unknown',
    })
    expect(callback.statusCode).toBe(400)
    expect(callback.json()).toEqual({ error: 'unknown_state' })

    const start = await app.inject({ method: 'GET', url: '/auth/csca/login' })
    const state = new URL(start.headers.location as string).searchParams.get('state')
    const first = await app.inject({
      method: 'GET',
      url: `/auth/csca/callback?code=abc&state=${state}`,
    })
    expect(first.statusCode).toBe(302)
    const second = await app.inject({
      method: 'GET',
      url: `/auth/csca/callback?code=abc&state=${state}`,
    })
    expect(second.statusCode).toBe(400)
  })

  it('does not follow open redirects', async () => {
    const start = await app.inject({
      method: 'GET',
      url: '/auth/csca/login?redirect_to=//evil.test',
    })
    const state = new URL(start.headers.location as string).searchParams.get('state')
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/csca/callback?code=abc&state=${state}`,
    })
    expect(callback.headers.location).toBe('/')
  })

  it('reports no session before login', async () => {
    const me = await app.inject({ method: 'GET', url: '/auth/dsc/me' })
    expect(me.statusCode).toBe(401)
  })
})
