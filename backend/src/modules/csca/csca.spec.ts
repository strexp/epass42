import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'

import { parseCertificatePem, verifyDscAgainstCsca } from '@pkd42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCscaKey } from './service'

const CSCA_ADMIN = {
  sub: 'csca-admin',
  name: 'CSCA Admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}
const OTHER_USER = {
  sub: 'other-user',
  name: 'Other User',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

interface Harness {
  app: FastifyInstance
  cscaCookie: string
  userCookie: string
  cscaPem: string
}

async function harness(cscaClaims: Record<string, unknown> = CSCA_ADMIN): Promise<Harness> {
  const oidc = new FakeOidc()
  oidc.set('csca-client', { subject: String(cscaClaims.sub), claims: cscaClaims })
  oidc.set('dsc-client', { subject: OTHER_USER.sub, claims: OTHER_USER })
  const built = await makeTestApp(oidc, { PKD42_CSCA_BOOTSTRAP: 'true' })
  const app = built.app

  async function login(realm: 'csca' | 'dsc'): Promise<string> {
    const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
    const state = new URL(start.headers.location as string).searchParams.get('state')
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/${realm}/callback?code=x&state=${state}`,
    })
    const cookie = callback.cookies.find((entry) => entry.name === `pkd42_${realm}_sid`)!
    return `${cookie.name}=${cookie.value}`
  }

  const cscaCookie = await login('csca')
  const userCookie = await login('dsc')
  const cscaPem = currentCscaKey(built.dbHandle.db)!.certPem
  return { app, cscaCookie, userCookie, cscaPem }
}

function json(res: LightMyRequestResponse): Record<string, unknown> {
  return res.json() as Record<string, unknown>
}

describe('M5 CSCA role', () => {
  it('bootstraps a CSCA key and issues a DSC via an approved application', async () => {
    const { app, cscaCookie, cscaPem } = await harness()

    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'AS4242422189 DSC', documentType: 'P' },
    })
    expect(submit.statusCode).toBe(201)
    const applicationId = json(submit).id as number

    const list = await app.inject({
      method: 'GET',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
    })
    expect(list.statusCode).toBe(200)
    expect(json(list).total).toBe(1)

    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${applicationId}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const certPem = json(approve).certPem as string

    // The issued DSC chains to the bootstrapped CSCA.
    const result = await verifyDscAgainstCsca(parseCertificatePem(certPem), [
      parseCertificatePem(cscaPem),
    ])
    expect(result.valid).toBe(true)

    // Approving twice is a conflict.
    const again = await app.inject({
      method: 'POST',
      url: `/csca/applications/${applicationId}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(again.statusCode).toBe(409)
  })

  it('publishes active DSC certificates and serves PEM/DER', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'Public DSC', documentType: 'P' },
    })
    const id = json(submit).id as number
    await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })

    const list = await app.inject({ method: 'GET', url: '/csca/certificates' })
    expect(list.statusCode).toBe(200)
    const items = json(list).items as { id: number }[]
    expect(items.length).toBeGreaterThanOrEqual(1)
    const certId = items[0].id

    const pem = await app.inject({ method: 'GET', url: `/csca/certificates/${certId}.pem` })
    expect(pem.statusCode).toBe(200)
    expect(pem.body).toContain('BEGIN CERTIFICATE')

    const der = await app.inject({ method: 'GET', url: `/csca/certificates/${certId}.der` })
    expect(der.statusCode).toBe(200)
    expect(der.rawPayload[0]).toBe(0x30)
  })

  it('revokes a DSC and hides it from the active list', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'Revocable DSC', documentType: 'P' },
    })
    const id = json(submit).id as number
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })
    const certId = json(approve).id as number

    const revoke = await app.inject({
      method: 'POST',
      url: `/csca/certificates/${certId}/revoke`,
      headers: { cookie: cscaCookie },
      payload: { reason: 'key compromise' },
    })
    expect(revoke.statusCode).toBe(200)
    expect(json(revoke).status).toBe('revoked')

    const active = await app.inject({ method: 'GET', url: '/csca/certificates' })
    const items = json(active).items as { id: number }[]
    expect(items.find((entry) => entry.id === certId)).toBeUndefined()

    const all = await app.inject({ method: 'GET', url: '/csca/certificates?includeRevoked=true' })
    expect((json(all).items as { id: number }[]).find((entry) => entry.id === certId)).toBeTruthy()
  })

  it('rejects an application with a reason', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'Rejected DSC', documentType: 'P' },
    })
    const id = json(submit).id as number
    const reject = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/reject`,
      headers: { cookie: cscaCookie },
      payload: { reason: 'incomplete' },
    })
    expect(reject.statusCode).toBe(200)
    expect(json(reject).status).toBe('rejected')
  })

  it('forbids non-admins from review endpoints', async () => {
    const { app, cscaCookie } = await harness(OTHER_USER)

    const list = await app.inject({
      method: 'GET',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
    })
    expect(list.statusCode).toBe(403)

    const rollover = await app.inject({
      method: 'POST',
      url: '/csca/keys/rollover',
      headers: { cookie: cscaCookie },
      payload: { confirm: true },
    })
    expect(rollover.statusCode).toBe(403)
  })

  it('requires a session to submit and validates the payload', async () => {
    const { app } = await harness()
    const anon = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      payload: { keyMode: 'nia_generated', subjectCn: 'X' },
    })
    expect(anon.statusCode).toBe(401)
  })

  it('lets an AS administrator view and switch NIA DSC delegation', async () => {
    const { app, cscaCookie } = await harness()
    const before = await app.inject({
      method: 'GET',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
    })
    expect(before.statusCode).toBe(200)
    expect(before.json().useNiaDsc).toBe(false)
    expect(before.json().hasActiveDsc).toBe(false)

    const enable = await app.inject({
      method: 'PUT',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
      payload: { useNiaDsc: true },
    })
    expect(enable.statusCode).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
    })
    expect(after.json().useNiaDsc).toBe(true)

    // Switching to the AS's own DSC is refused until one is approved.
    const refused = await app.inject({
      method: 'PUT',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
      payload: { useNiaDsc: false },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toBe('no_active_dsc')

    // After an application is approved for this AS, the switch is allowed.
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'AS own DSC', documentType: 'P' },
    })
    await app.inject({
      method: 'POST',
      url: `/csca/applications/${submit.json().id}/approve`,
      headers: { cookie: cscaCookie },
    })
    const status = await app.inject({
      method: 'GET',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
    })
    expect(status.json().hasActiveDsc).toBe(true)
    const own = await app.inject({
      method: 'PUT',
      url: '/csca/settings/as',
      headers: { cookie: cscaCookie },
      payload: { useNiaDsc: false },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json().useNiaDsc).toBe(false)
  })
})
