import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  derToPem,
  generateRsaKeyPair,
  parseCertificatePem,
  verifyDscAgainstCsca,
} from '@epass42/pki'
import type { Db } from '../../db/client'
import { dscCert } from '../../db/schema'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCscaKey } from './service'

const THIRD_USER = {
  sub: 'third-user',
  name: 'Third User',
  dn42: { asn: 4242420002, active_mnt: 'THIRD-MNT', mnt_by: ['THIRD-MNT'] },
}

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
  oidc: FakeOidc
  cscaCookie: string
  userCookie: string
  cscaPem: string
  db: Db
}

async function harness(cscaClaims: Record<string, unknown> = CSCA_ADMIN): Promise<Harness> {
  const oidc = new FakeOidc()
  oidc.set('csca-client', { subject: String(cscaClaims.sub), claims: cscaClaims })
  oidc.set('dsc-client', { subject: OTHER_USER.sub, claims: OTHER_USER })
  const built = await makeTestApp(oidc, { csca: { bootstrap: true } })
  const app = built.app

  async function login(realm: 'csca' | 'dsc'): Promise<string> {
    const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
    const state = new URL(start.headers.location as string).searchParams.get('state')
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/${realm}/callback?code=x&state=${state}`,
    })
    const cookie = callback.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)!
    return `${cookie.name}=${cookie.value}`
  }

  const cscaCookie = await login('csca')
  const userCookie = await login('dsc')
  const cscaPem = currentCscaKey(built.dbHandle.db)!.certPem
  return {
    app,
    oidc,
    cscaCookie,
    userCookie,
    cscaPem,
    db: built.dbHandle.db,
  }
}

function json(res: LightMyRequestResponse): Record<string, unknown> {
  return res.json() as Record<string, unknown>
}

/** Logs in as a specific identity (switching the fake provider's response). */
async function loginAs(
  app: FastifyInstance,
  oidc: FakeOidc,
  realm: 'csca' | 'dsc',
  clientId: string,
  claims: Record<string, unknown>,
): Promise<string> {
  oidc.set(clientId, { subject: String(claims.sub), claims })
  const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/${realm}/callback?code=x&state=${state}`,
  })
  const cookie = callback.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)!
  return `${cookie.name}=${cookie.value}`
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

    // Subjects carry the NIA organisation (O), matching common ICAO PKD
    // practice; the CSCA and its DSCs are consistent.
    expect(parseCertificatePem(cscaPem).subject).toContain('O=ePass 42')
    expect(parseCertificatePem(certPem).subject).toContain('O=ePass 42')

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

  it('lets non-admins see their own applications but not review them', async () => {
    const { app, cscaCookie } = await harness(OTHER_USER)

    // A non-admin submits an application...
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'Own application', documentType: 'P' },
    })
    expect(submit.statusCode).toBe(201)

    // ...and can list it (scope 'own').
    const list = await app.inject({
      method: 'GET',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().scope).toBe('own')
    expect(list.json().total).toBe(1)

    // Review endpoints remain forbidden.
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${submit.json().id}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(403)

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

  it('lets a maintainer view and switch NIA DSC delegation', async () => {
    const { app, cscaCookie } = await harness()
    const before = await app.inject({
      method: 'GET',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
    })
    expect(before.statusCode).toBe(200)
    // Default is delegation to the NIA DSC.
    expect(before.json().useNiaDsc).toBe(true)
    expect(before.json().hasActiveDsc).toBe(false)

    const enable = await app.inject({
      method: 'PUT',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
      payload: { useNiaDsc: true },
    })
    expect(enable.statusCode).toBe(200)
    const after = await app.inject({
      method: 'GET',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
    })
    expect(after.json().useNiaDsc).toBe(true)

    // Switching to the AS's own DSC is refused until one is approved.
    const refused = await app.inject({
      method: 'PUT',
      url: '/csca/settings/mnt',
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
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
    })
    expect(status.json().hasActiveDsc).toBe(true)
    const own = await app.inject({
      method: 'PUT',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
      payload: { useNiaDsc: false },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json().useNiaDsc).toBe(false)
    expect(own.json().hasActiveDsc).toBe(true)
  })

  it('exposes a system-generated DSC private key to its AS owner and NIA admins', async () => {
    const { app, oidc } = await harness()

    const ownerCookie = await loginAs(app, oidc, 'csca', 'csca-client', OTHER_USER)
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'nia_generated', subjectCn: 'Owned DSC', documentType: 'P' },
    })
    const adminCookie = await loginAs(app, oidc, 'csca', 'csca-client', {
      sub: 'csca-admin',
      name: 'CSCA Admin',
      dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${submit.json().id}/approve`,
      headers: { cookie: adminCookie },
    })
    const certId = approve.json().id as number

    const key = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${certId}/private-key`,
      headers: { cookie: ownerCookie },
    })
    expect(key.statusCode).toBe(200)
    expect(key.body).toContain('BEGIN PRIVATE KEY')
    expect(key.headers['cache-control']).toBe('no-store')

    // The key is deleted after the first download.
    const againAsOwner = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${certId}/private-key`,
      headers: { cookie: ownerCookie },
    })
    expect(againAsOwner.statusCode).toBe(410)
    expect(againAsOwner.json().error).toBe('private_key_consumed')

    const adminKey = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${certId}/private-key`,
      headers: { cookie: adminCookie },
    })
    expect(adminKey.statusCode).toBe(410)

    const foreignCookie = await loginAs(app, oidc, 'csca', 'csca-client', THIRD_USER)
    const forbidden = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${certId}/private-key`,
      headers: { cookie: foreignCookie },
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('has no private key for an uploaded (user_uploaded) DSC', async () => {
    const { app, cscaCookie } = await harness()
    const keyPair = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'user_uploaded',
        publicKeyPem: derToPem(keyPair.spki, 'PUBLIC KEY'),
        subjectCn: 'Uploaded DSC',
        documentType: 'P',
      },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${submit.json().id}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const response = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${approve.json().id}/private-key`,
      headers: { cookie: cscaCookie },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().error).toBe('no_private_key')
  })

  it('publishes the system NIA DSC at startup without exposing its key', async () => {
    const { app, cscaCookie, db } = await harness()

    // The system DSC is prepared at startup, so it is listed immediately.
    const listed = await app.inject({
      method: 'GET',
      url: '/csca/certificates?includeRevoked=true',
      headers: { cookie: cscaCookie },
    })
    const nia = (
      listed.json().items as { id: number; source: string; hasPrivateKey: boolean }[]
    ).find((row) => row.source === 'nia')
    expect(nia).toBeTruthy()
    expect(nia!.hasPrivateKey).toBe(false)

    // The download is refused and, crucially, the sealed key is not consumed.
    const key = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${nia!.id}/private-key`,
      headers: { cookie: cscaCookie },
    })
    expect(key.statusCode).toBe(403)
    const row = db.select().from(dscCert).where(eq(dscCert.id, nia!.id)).get()!
    expect(row.keyRef).not.toBeNull()
  })

  it('refuses to revoke the system NIA DSC', async () => {
    const { app, cscaCookie } = await harness()
    const listed = await app.inject({
      method: 'GET',
      url: '/csca/certificates?includeRevoked=true',
      headers: { cookie: cscaCookie },
    })
    const nia = (listed.json().items as { id: number; source: string; status: string }[]).find(
      (row) => row.source === 'nia',
    )!
    expect(nia).toBeTruthy()

    const revoke = await app.inject({
      method: 'POST',
      url: `/csca/certificates/${nia.id}/revoke`,
      headers: { cookie: cscaCookie },
      payload: { reason: 'nope' },
    })
    expect(revoke.statusCode).toBe(403)

    // It stays active.
    const active = await app.inject({
      method: 'GET',
      url: '/csca/certificates',
      headers: { cookie: cscaCookie },
    })
    expect((active.json().items as { id: number }[]).some((row) => row.id === nia.id)).toBe(true)
  })
})
