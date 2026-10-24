import { describe, expect, it } from 'vitest'

import { FakeOidc, makeTestApp } from '../../test-support'

const PROVIDERS = [
  {
    realms: ['dsc'],
    issuer: 'https://alpha.idp.test',
    clientId: 'alpha-client',
    alias: 'alpha',
    scopes: ['openid', 'dn42'],
  },
  {
    realms: ['dsc'],
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
  return makeTestApp(oidc, { oauthProviders: PROVIDERS })
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

const SHARED_PROVIDERS = [
  {
    realms: ['csca', 'dsc'],
    issuer: 'https://shared.idp.test',
    clientId: 'shared-client',
    alias: 'shared',
    scopes: ['openid', 'dn42'],
  },
]

async function sharedSetup() {
  const oidc = new FakeOidc()
  oidc.set('shared-client', {
    subject: 'shared-user',
    claims: { sub: 'shared-user', dn42: { asn: 42 } },
  })
  return makeTestApp(oidc, { oauthProviders: SHARED_PROVIDERS })
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
    expect(callback.cookies.find((entry) => entry.name === 'epass42_dsc_sid')).toBeTruthy()
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

  it('seeds one provider definition into every allowed realm with stable callbacks', async () => {
    const { app } = await sharedSetup()
    const config = await app.inject({ method: 'GET', url: '/api/config' })
    const providers = config.json().oauthProviders as Record<
      string,
      { alias: string; issuer: string }[]
    >
    expect(providers.csca).toHaveLength(1)
    expect(providers.dsc).toHaveLength(1)
    expect(providers.csca[0]).toMatchObject({
      alias: 'shared',
      issuer: 'https://shared.idp.test',
    })
    expect(providers.dsc[0]).toMatchObject({
      alias: 'shared',
      issuer: 'https://shared.idp.test',
    })

    // The realm still selects the callback endpoint; only the configuration
    // definition is shared between realms.
    for (const realm of ['csca', 'dsc'] as const) {
      const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
      expect(start.statusCode).toBe(302)
      const state = new URL(start.headers.location as string).searchParams.get('state')
      const callback = await app.inject({
        method: 'GET',
        url: `/auth/${realm}/callback/shared?code=x&state=${state}`,
      })
      expect(callback.statusCode).toBe(302)
      expect(callback.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)).toBeTruthy()
    }
  })
})
