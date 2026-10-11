import { describe, expect, it } from 'vitest'

import { makeTestApp, makeTestConfig, FakeOidc } from './test-support'

async function app() {
  return makeTestApp(new FakeOidc())
}

describe('M3 backend skeleton', () => {
  it('serves /healthz', async () => {
    const { app: instance } = await app()
    const response = await instance.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    expect(response.headers['x-request-id']).toBeTruthy()
  })

  it('serves /readyz after migrations create the schema', async () => {
    const { app: instance, dbHandle } = await app()
    const response = await instance.inject({ method: 'GET', url: '/readyz' })
    expect(response.statusCode).toBe(200)
    // A known table exists, proving the migration ran.
    const row = dbHandle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sign_request'")
      .get() as { name: string } | undefined
    expect(row?.name).toBe('sign_request')
    // The expression index from the custom migration is present.
    const index = dbHandle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='ux_sign_request_mrz'")
      .get() as { name: string } | undefined
    expect(index?.name).toBe('ux_sign_request_mrz')
  })

  it('exposes role and country configuration', async () => {
    const { app: instance } = await app()
    const response = await instance.inject({ method: 'GET', url: '/api/config' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.roles).toEqual(['pkd', 'csca', 'dsc'])
    expect(body.countryAlpha2).toBe('XD')
    expect(body.countryAlpha3).toBe('UDN')
    expect(body.oauthProviders.csca).toHaveLength(1)
    expect(body.oauthProviders.dsc).toHaveLength(1)
  })

  it('returns a structured 404', async () => {
    const { app: instance } = await app()
    const response = await instance.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })
})

describe('M13/T13.7 reverse proxy trust', () => {
  it('defaults trustProxy to loopback and accepts an explicit list', () => {
    expect(makeTestConfig().trustProxy).toEqual(['127.0.0.1', '::1'])
    expect(makeTestConfig({ trustProxy: true }).trustProxy).toBe(true)
    expect(makeTestConfig({ trustProxy: false }).trustProxy).toBe(false)
    expect(makeTestConfig({ trustProxy: ['10.0.0.0/8'] }).trustProxy).toEqual(['10.0.0.0/8'])
  })

  it('honours X-Forwarded-For only from a trusted proxy', async () => {
    const seen: string[] = []
    const resolver = {
      async resolve(ip: string): Promise<string[]> {
        seen.push(ip)
        return []
      },
    }
    const { app: instance } = await makeTestApp(new FakeOidc(), {}, resolver)

    // From loopback (trusted by default) the forwarded address is used.
    await instance.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
    expect(seen).toEqual(['203.0.113.7'])

    // From an untrusted peer the header is ignored; the socket address wins.
    await instance.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '198.51.100.9',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })
    expect(seen).toEqual(['203.0.113.7', '198.51.100.9'])
  })
})
