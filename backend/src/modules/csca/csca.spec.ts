import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  certificateCoversDocumentType,
  derToPem,
  documentTypesOfCertificate,
  generateRsaKeyPair,
  parseCertificatePem,
  validateCertProfile,
  verifyDscAgainstCsca,
} from '@epass42/pki'
import { OIDS } from '@epass42/shared'
import type { Db } from '../../db/client'
import { cscaKey, dscCert } from '../../db/schema'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCscaKey } from './service'
import { privateKeyNotAfter } from '../../util/certificate'

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
  it('takes the CSCA country and SAN locality from the configured country codes', async () => {
    const built = await makeTestApp(new FakeOidc(), {
      countryAlpha2: 'ZZ',
      countryAlpha3: 'ZZZ',
      csca: { bootstrap: true },
    })
    const csca = parseCertificatePem(currentCscaKey(built.dbHandle.db)!.certPem)
    expect(csca.subject).toContain('C=ZZ')
    const san = csca.getExtension(OIDS.subjectAltName)!
    expect(Buffer.from(san.value).includes(Buffer.from('ZZZ'))).toBe(true)
    expect(built.config.countryAlpha3).toBe('ZZZ')
  })

  it('bootstraps a CSCA key and issues a DSC via an approved application', async () => {
    const { app, cscaCookie, cscaPem } = await harness()

    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'AS4242422189 DSC', documentTypes: ['P'] },
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

  it('issues DSCs for the concrete ID/IP types and the I* wildcard', async () => {
    const { app, cscaCookie } = await harness()

    for (const documentType of ['ID', 'IP', 'I'] as const) {
      const submit = await app.inject({
        method: 'POST',
        url: '/csca/applications',
        headers: { cookie: cscaCookie },
        payload: {
          keyMode: 'remote_generated',
          subjectCn: `${documentType} DSC`,
          documentTypes: [documentType],
        },
      })
      expect(submit.statusCode).toBe(201)
      const approve = await app.inject({
        method: 'POST',
        url: `/csca/applications/${json(submit).id as number}/approve`,
        headers: { cookie: cscaCookie },
      })
      expect(approve.statusCode).toBe(201)
      const certificate = parseCertificatePem(json(approve).certPem as string)
      expect(documentTypesOfCertificate(certificate)).toEqual([documentType])
      if (documentType === 'I') {
        expect(certificateCoversDocumentType(certificate, 'ID')).toBe(true)
        expect(certificateCoversDocumentType(certificate, 'IP')).toBe(true)
        expect(certificateCoversDocumentType(certificate, 'P')).toBe(false)
      }
    }

    const invalid = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Bad DSC', documentTypes: ['X'] },
    })
    expect(invalid.statusCode).toBe(400)

    const tooMany = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'Too many DSC',
        documentTypes: ['P', 'ID', 'IP'],
      },
    })
    expect(tooMany.statusCode).toBe(400)
  })

  it('issues a DSC authorized for a selected P+I pair', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'P and I DSC',
        documentTypes: ['P', 'I'],
      },
    })
    expect(submit.statusCode).toBe(201)
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${json(submit).id as number}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const certificate = parseCertificatePem(json(approve).certPem as string)
    expect(documentTypesOfCertificate(certificate)).toEqual(['I', 'P'])
    expect(certificateCoversDocumentType(certificate, 'P')).toBe(true)
    expect(certificateCoversDocumentType(certificate, 'ID')).toBe(true)
    expect(certificateCoversDocumentType(certificate, 'IP')).toBe(true)

    // The application detail exposes the selected list.
    const detail = await app.inject({
      method: 'GET',
      url: `/csca/applications/${json(submit).id as number}`,
      headers: { cookie: cscaCookie },
    })
    expect(json(detail).documentTypes).toEqual(['P', 'I'])
  })

  it('publishes active DSC certificates and serves PEM/DER', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Public DSC', documentTypes: ['P'] },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'Revocable DSC', documentTypes: ['P'] },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'Rejected DSC', documentTypes: ['P'] },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'Own application', documentTypes: ['P'] },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'X' },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'AS own DSC', documentTypes: ['P'] },
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
      payload: { keyMode: 'remote_generated', subjectCn: 'Owned DSC', documentTypes: ['P'] },
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

    // The application exposes the issued certificate and its one-time key.
    const detailBefore = await app.inject({
      method: 'GET',
      url: `/csca/applications/${submit.json().id}`,
      headers: { cookie: ownerCookie },
    })
    expect(detailBefore.json().dscCertId).toBe(certId)
    expect(detailBefore.json().hasPrivateKey).toBe(true)

    const key = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${certId}/private-key`,
      headers: { cookie: ownerCookie },
    })
    expect(key.statusCode).toBe(200)
    expect(key.body).toContain('BEGIN PRIVATE KEY')
    expect(key.headers['cache-control']).toBe('no-store')

    const detailAfter = await app.inject({
      method: 'GET',
      url: `/csca/applications/${submit.json().id}`,
      headers: { cookie: ownerCookie },
    })
    expect(detailAfter.json().hasPrivateKey).toBe(false)

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
        documentTypes: ['P'],
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

  it('carries the applicant-chosen O and OU into the issued DSC', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'OU DSC',
        subjectO: 'Example Org',
        subjectOu: 'Example Unit',
        documentTypes: ['P'],
      },
    })
    const id = json(submit).id as number

    const detail = await app.inject({
      method: 'GET',
      url: `/csca/applications/${id}`,
      headers: { cookie: cscaCookie },
    })
    expect(json(detail).subjectO).toBe('Example Org')
    expect(json(detail).subjectOu).toBe('Example Unit')

    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })
    const pem = await app.inject({
      method: 'GET',
      url: `/csca/certificates/${json(approve).id}.pem`,
    })
    const certificate = parseCertificatePem(pem.body)
    expect(certificate.subjectName.getField('O')).toEqual(['Example Org'])
    expect(certificate.subjectName.getField('OU')).toEqual(['Example Unit'])
  })

  it('issues an LDS2 Signer and publishes its certificate type', async () => {
    const { app, cscaCookie, cscaPem } = await harness()

    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        certificateType: 'lds2',
        subjectCn: 'LDS2TVB',
        lds2Types: ['ts', 'v', 'b'],
        validityDays: 3760,
      },
    })
    expect(submit.statusCode).toBe(201)
    const id = json(submit).id as number

    // The application detail keeps the certificate type, so the UI classifies
    // it as LDS2 rather than falling back to DSC.
    const detail = await app.inject({
      method: 'GET',
      url: `/csca/applications/${id}`,
      headers: { cookie: cscaCookie },
    })
    expect(json(detail).certificateType).toBe('lds2')
    expect(json(detail).lds2Types).toEqual(['ts', 'v', 'b'])

    // LDS2 certificates never satisfy the maintainer's DSC delegation.
    const delegation = await app.inject({
      method: 'GET',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
    })
    expect(json(delegation).hasActiveDsc).toBe(false)

    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const meta = json(approve)
    expect(meta.certificateType).toBe('lds2')
    expect(meta.lds2Types).toEqual(['ts', 'v', 'b'])
    expect(meta.documentTypes).toEqual([])

    const certificate = parseCertificatePem(meta.certPem as string)
    expect(certificate.subjectName.getField('O')).toEqual([])
    expect(certificate.subjectName.getField('OU')).toEqual([])
    expect(certificate.subjectName.getField('C')).toEqual(['XD'])
    expect(certificate.subjectName.getField('CN')).toEqual(['LDS2TVB'])
    expect(certificate.getExtension(OIDS.keyUsage)).toBeFalsy()
    expect(certificate.getExtension(OIDS.subjectAltName)).toBeFalsy()
    expect(certificate.getExtension(OIDS.idIcaoDocumentType)).toBeFalsy()
    const eku = certificate.getExtension(OIDS.extKeyUsage) as unknown as {
      critical: boolean
      usages: string[]
    }
    expect(eku.critical).toBe(true)
    expect(eku.usages).toEqual([OIDS.lds2TsSigner, OIDS.lds2VisaSigner, OIDS.lds2BiometricsSigner])
    expect(certificate.publicKey.algorithm.name).toBe('ECDSA')

    // The profile and chain both validate against the CSCA.
    expect(validateCertProfile(certificate, 'lds2-signer')).toEqual({ valid: true, errors: [] })
    const chain = await verifyDscAgainstCsca(
      certificate,
      [parseCertificatePem(cscaPem)],
      'lds2-signer',
    )
    expect(chain.valid).toBe(true)

    // The certificate registry and the PKD list tag the certificate type.
    const registry = await app.inject({
      method: 'GET',
      url: '/csca/certificates',
      headers: { cookie: cscaCookie },
    })
    const listed = (json(registry).items as { id: number; certificateType: string }[]).find(
      (row) => row.id === meta.id,
    )
    expect(listed?.certificateType).toBe('lds2')

    const pkd = await app.inject({ method: 'GET', url: '/pkd/dscs' })
    const published = (
      json(pkd).items as { id: number; certificateType: string; lds2Types: string[] }[]
    ).find((row) => row.id === meta.id)
    expect(published?.certificateType).toBe('lds2')
    expect(published?.lds2Types).toEqual(['ts', 'v', 'b'])

    // The delegation still ignores LDS2 certificates.
    const after = await app.inject({
      method: 'GET',
      url: '/csca/settings/mnt',
      headers: { cookie: cscaCookie },
    })
    expect(json(after).hasActiveDsc).toBe(false)
  })

  it('validates LDS2 applications and rejects non-ECDSA subject keys', async () => {
    const { app, cscaCookie } = await harness()

    const tooLong = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        certificateType: 'lds2',
        subjectCn: 'TOO-LONG-CN',
        lds2Types: ['ts'],
      },
    })
    expect(tooLong.statusCode).toBe(400)

    const noRole = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', certificateType: 'lds2', subjectCn: 'LDS2' },
    })
    expect(noRole.statusCode).toBe(400)

    const duplicate = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'remote_generated',
        certificateType: 'lds2',
        subjectCn: 'LDS2',
        lds2Types: ['ts', 'ts'],
      },
    })
    expect(duplicate.statusCode).toBe(400)

    // LDS2 Signers MUST use ECDSA (Doc 9303-12 §4.1.7), so an RSA SPKI fails
    // at approval instead of producing a non-conforming certificate.
    const rsa = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const uploaded = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: {
        keyMode: 'user_uploaded',
        certificateType: 'lds2',
        subjectCn: 'LDS2RSA',
        lds2Types: ['b'],
        publicKeyPem: derToPem(rsa.spki, 'PUBLIC KEY'),
      },
    })
    expect(uploaded.statusCode).toBe(201)
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${json(uploaded).id as number}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(400)
  })
  it('lets an owner self-revoke an owned DSC and rejects other maintainers', async () => {
    const { app, oidc, cscaCookie } = await harness()
    const ownerCookie = await loginAs(app, oidc, 'csca', 'csca-client', OTHER_USER)
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Self Revocable DSC' },
    })
    expect(submit.statusCode).toBe(201)
    const id = json(submit).id as number
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const certId = json(approve).id as number

    const otherCookie = await loginAs(app, oidc, 'csca', 'csca-client', THIRD_USER)
    const refused = await app.inject({
      method: 'POST',
      url: `/csca/certificates/${certId}/revoke`,
      headers: { cookie: otherCookie },
    })
    expect(refused.statusCode).toBe(403)

    const revoke = await app.inject({
      method: 'POST',
      url: `/csca/certificates/${certId}/revoke`,
      headers: { cookie: ownerCookie },
      payload: { reason: 'lost key' },
    })
    expect(revoke.statusCode).toBe(200)
    expect(json(revoke).status).toBe('revoked')

    const again = await app.inject({
      method: 'POST',
      url: `/csca/certificates/${certId}/revoke`,
      headers: { cookie: ownerCookie },
    })
    expect(again.statusCode).toBe(409)
    expect(json(again).error).toBe('certificate_not_active')
  })

  it('blocks new DSC/LDS2 applications and approval when the CSCA has expired', async () => {
    const { app, cscaCookie, db } = await harness()
    // Create a pending application before expiry.
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Pending DSC' },
    })
    const id = json(submit).id as number

    db.update(cscaKey).set({ notAfter: '2000-01-01T00:00:00.000Z' }).run()

    const status = await app.inject({ method: 'GET', url: '/csca/status' })
    expect(json(status).canIssueCertificates).toBe(false)
    expect((json(status).csca as { expired: boolean }).expired).toBe(true)

    const blockedSubmit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Blocked DSC' },
    })
    expect(blockedSubmit.statusCode).toBe(409)
    expect(json(blockedSubmit).error).toBe('csca_expired')

    const blockedApprove = await app.inject({
      method: 'POST',
      url: `/csca/applications/${id}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(blockedApprove.statusCode).toBe(409)
    expect(json(blockedApprove).error).toBe('csca_expired')
  })
  it('uses the configured country code in the DSC SAN/IAN', async () => {
    const built = await makeTestApp(new FakeOidc(), {
      countryAlpha2: 'ZZ',
      countryAlpha3: 'ZZZ',
      csca: { bootstrap: true },
    })
    const nia = await built.csca.ensureNiaDsc()
    const cert = parseCertificatePem(nia!.certPem)
    const san = cert.getExtension(OIDS.subjectAltName)!
    const ian = cert.getExtension(OIDS.issuerAltName)!
    expect(Buffer.from(san.value).includes(Buffer.from('ZZZ'))).toBe(true)
    expect(Buffer.from(ian.value).includes(Buffer.from('ZZZ'))).toBe(true)
    expect(Buffer.from(san.value).includes(Buffer.from('XDN'))).toBe(false)
  })

  it('sets the DSC private-key usage period to 90 days by default', async () => {
    const { app, cscaCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Short-lived DSC' },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${json(submit).id as number}/approve`,
      headers: { cookie: cscaCookie },
    })
    expect(approve.statusCode).toBe(201)
    const end = privateKeyNotAfter(json(approve).certPem as string)!
    const days = (end.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(88)
    expect(days).toBeLessThan(92)
  })

  it('rejects unsafe subject names and DSC validity above 10 years', async () => {
    const { app, cscaCookie } = await harness()
    for (const payload of [
      { subjectCn: 'Bad, C=ZZ' },
      { subjectCn: 'Bad;Name' },
      { subjectCn: 'Bad=Name' },
      { subjectCn: 'Good DSC', validityDays: 3651 },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/csca/applications',
        headers: { cookie: cscaCookie },
        payload: { keyMode: 'remote_generated', ...payload },
      })
      expect(response.statusCode).toBe(400)
    }

    const accepted = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie: cscaCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Good DSC', validityDays: 3650 },
    })
    expect(accepted.statusCode).toBe(201)
  })
})
