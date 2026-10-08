import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'

import { FakeOidc, makeTestApp } from '../../test-support'

const CSCA_ADMIN = {
  sub: 'csca-admin',
  dn42: { active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}
const DSC_ADMIN = {
  sub: 'dsc-admin',
  dn42: { active_mnt: 'EXAMPLE-DSC-MNT', mnt_by: ['EXAMPLE-DSC-MNT'] },
}

function cookieOf(response: LightMyRequestResponse, realm: 'csca' | 'dsc'): string {
  const cookie = response.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)!
  return `${cookie.name}=${cookie.value}`
}

async function login(
  app: FastifyInstance,
  oidc: FakeOidc,
  realm: 'csca' | 'dsc',
  claims: Record<string, unknown>,
): Promise<string> {
  oidc.set(`${realm}-client`, { subject: String(claims.sub), claims })
  const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/${realm}/callback?code=x&state=${state}`,
  })
  return cookieOf(callback, realm)
}

async function harness() {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc)
  return { app: built.app, oidc }
}

describe('M13 audit log viewing', () => {
  it('lets a realm administrator read the realm audit trail', async () => {
    const { app, oidc } = await harness()
    const cookie = await login(app, oidc, 'csca', CSCA_ADMIN)
    const response = await app.inject({ method: 'GET', url: '/csca/audit', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    const items = response.json().items as { action: string; actor: string | null }[]
    expect(items.some((entry) => entry.action === 'auth.login')).toBe(true)
  })

  it('rejects anonymous and cross-realm access', async () => {
    const { app, oidc } = await harness()
    expect((await app.inject({ method: 'GET', url: '/csca/audit' })).statusCode).toBe(401)

    // A CSCA administrator is not a DSC administrator (separate realm cookies).
    const cookie = await login(app, oidc, 'csca', CSCA_ADMIN)
    const cross = await app.inject({ method: 'GET', url: '/dsc/audit', headers: { cookie } })
    expect(cross.statusCode).toBe(401)

    const dsc = await login(app, oidc, 'dsc', DSC_ADMIN)
    expect(
      (await app.inject({ method: 'GET', url: '/dsc/audit', headers: { cookie: dsc } })).statusCode,
    ).toBe(200)
  })
})
