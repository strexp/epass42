import { describe, expect, it } from 'vitest'

import { FakeOidc, makeTestApp } from '../../test-support'

const PROVIDERS = [
  {
    realm: 'dsc',
    issuer: 'https://alpha.idp.test',
    clientId: 'alpha-client',
    alias: 'alpha',
    scopes: ['openid', 'dn42'],
  },
  {
    realm: 'dsc',
    issuer: 'https://beta.idp.test',
    clientId: 'beta-client',
    alias: 'beta',
    scopes: ['openid', 'dn42'],
  },
]

async function setup() {
  const oidc = new FakeOidc()
  oidc.set('alpha-client', {
    subject: 'alpha-user',
    claims: { sub: 'alpha-user', dn42: { asn: 1 } },
  })
  oidc.set('beta-client', { subject: 'beta-user', claims: { sub: 'beta-user', dn42: { asn: 2 } } })
  return makeTestApp(oidc, { PKD42_OAUTH_PROVIDERS: JSON.stringify(PROVIDERS) })
}

/** Starts a login and returns the flow state from the redirect. */
async function startState(
  app: Awaited<ReturnType<typeof setup>>['app'],
  provider?: string,
): Promise<string> {
  const url = provider ? `/auth/dsc/login?provider=${provider}` : '/auth/dsc/login'
  const start = await app.inject({ method: 'GET', url })
  expect(start.statusCode).toBe(302)
  return new URL(start.headers.location as string).searchParams.get('state') as string
}

describe('multiple OAuth providers per realm', () => {
  it('exposes each provider with its alias', async () => {
    const { app } = await setup()
    const config = await app.inject({ method: 'GET', url: '/api/config' })
    const providers = config.json().oauthProviders.dsc as { alias: string; issuer: string }[]
    expect(providers.map((p) => p.alias).sort()).toEqual(['alpha', 'beta'])
  })

  it('logs in through a selected alias and completes the aliased callback', async () => {
    const { app } = await setup()
    const state = await startState(app, 'beta')
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/dsc/callback/beta?code=x&state=${state}`,
    })
    expect(callback.statusCode).toBe(302)
    expect(callback.cookies.find((entry) => entry.name === 'pkd42_dsc_sid')).toBeTruthy()
  })

  it('rejects a callback whose alias does not match the state', async () => {
    const { app } = await setup()
    const state = await startState(app, 'alpha')
    const mismatched = await app.inject({
      method: 'GET',
      url: `/auth/dsc/callback/beta?code=x&state=${state}`,
    })
    expect(mismatched.statusCode).toBe(400)
    expect(mismatched.json().error).toBe('alias_mismatch')
  })

  it('defaults to the first provider when none is chosen', async () => {
    const { app } = await setup()
    const state = await startState(app)
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/dsc/callback/alpha?code=x&state=${state}`,
    })
    expect(callback.statusCode).toBe(302)
  })
})
