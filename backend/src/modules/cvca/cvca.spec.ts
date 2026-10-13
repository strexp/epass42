import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'

import {
  cvPublicKey,
  derToPem,
  generateRsaKeyPair,
  parseCvCertificate,
  verifyCvCertificate,
} from '@epass42/pki'
import type { Db } from '../../db/client'
import { cvcaKey } from '../../db/schema'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCvcaKey } from './service'

const CVCA_ADMIN = {
  sub: 'cvca-admin',
  name: 'CVCA Admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CVCA-MNT', mnt_by: ['EXAMPLE-CVCA-MNT'] },
}
const OTHER_USER = {
  sub: 'dv-user',
  name: 'DV User',
  dn42: { asn: 4242420002, active_mnt: 'DV-MNT', mnt_by: ['DV-MNT'] },
}
/** A DV-realm administrator (the realm that reviews terminal applications). */
const DV_ADMIN = {
  sub: 'dv-admin',
  name: 'DV Admin',
  dn42: { asn: 4242422100, active_mnt: 'EXAMPLE-DV-MNT', mnt_by: ['EXAMPLE-DV-MNT'] },
}

const PERMISSIONS = {
  epassport: { dg3: true, dg4: false },
  travel: { read: true, write: false },
  visa: { read: true, write: true },
  biometrics: { read: false, write: false },
}

interface Harness {
  app: FastifyInstance
  oidc: FakeOidc
  adminCookie: string
  db: Db
}

async function harness(adminClaims: Record<string, unknown> = CVCA_ADMIN): Promise<Harness> {
  const oidc = new FakeOidc()
  oidc.set('cvca-client', { subject: String(adminClaims.sub), claims: adminClaims })
  oidc.set('dsc-client', { subject: OTHER_USER.sub, claims: OTHER_USER })
  const built = await makeTestApp(oidc, { cvca: { bootstrap: true } })
  const app = built.app
  const adminCookie = await loginCvca(app, oidc, adminClaims)
  return { app, oidc, adminCookie, db: built.dbHandle.db }
}

/** Logs in to the CVCA realm as a specific identity (switching the provider). */
async function loginCvca(
  app: FastifyInstance,
  oidc: FakeOidc,
  claims: Record<string, unknown>,
): Promise<string> {
  oidc.set('cvca-client', { subject: String(claims.sub), claims })
  const start = await app.inject({ method: 'GET', url: '/auth/cvca/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/cvca/callback?code=x&state=${state}`,
  })
  const cookie = callback.cookies.find((entry) => entry.name === 'epass42_cvca_sid')!
  return `${cookie.name}=${cookie.value}`
}

/** Logs in to the DV realm as a specific identity (switching the provider). */
async function loginDv(
  app: FastifyInstance,
  oidc: FakeOidc,
  claims: Record<string, unknown>,
): Promise<string> {
  oidc.set('dv-client', { subject: String(claims.sub), claims })
  const start = await app.inject({ method: 'GET', url: '/auth/dv/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/dv/callback?code=x&state=${state}`,
  })
  const cookie = callback.cookies.find((entry) => entry.name === 'epass42_dv_sid')!
  return `${cookie.name}=${cookie.value}`
}

function json(res: LightMyRequestResponse): Record<string, unknown> {
  return res.json() as Record<string, unknown>
}

describe('M17 CVCA role', () => {
  it('bootstraps a CVCA and issues a chaining DV via an approved application', async () => {
    const { app, adminCookie, db } = await harness()

    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: adminCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'Border Police DV',
        permissions: PERMISSIONS,
      },
    })
    expect(submit.statusCode).toBe(201)
    const id = json(submit).id as number

    const approve = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${id}/approve`,
      headers: { cookie: adminCookie },
    })
    expect(approve.statusCode).toBe(201)
    const meta = json(approve)
    expect(meta.permissions).toEqual(PERMISSIONS)
    expect(meta.dvClass).toBe('domestic')

    // The issued DV chains to the bootstrapped CVCA.
    const dvDer = await app.inject({ method: 'GET', url: `/cvca/certificates/${meta.id}.der` })
    const dv = parseCvCertificate(new Uint8Array(dvDer.rawPayload))
    expect(dv.role).toBe('dv')
    expect(dv.dvClass).toBe('domestic')
    expect(dv.permissions).toEqual(PERMISSIONS)

    const cvcaRow = currentCvcaKey(db)!
    const cvca = parseCvCertificate(new Uint8Array(cvcaRow.certDer))
    expect(cvca.role).toBe('cvca')
    expect(dv.authorityReference).toBe(cvca.holderReference)
    expect(await verifyCvCertificate(dv, await cvPublicKey(cvca))).toBe(true)

    // Approving twice is a conflict.
    const again = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${id}/approve`,
      headers: { cookie: adminCookie },
    })
    expect(again.statusCode).toBe(409)
  })

  it('lets an administrator override the requested permissions and class at approval', async () => {
    const { app, adminCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: adminCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'Foreign read-only DV',
        dvClass: 'domestic',
        permissions: PERMISSIONS,
      },
    })
    const id = json(submit).id as number

    const override = {
      epassport: { dg3: false, dg4: true },
      travel: { read: false, write: false },
      visa: { read: true, write: false },
      biometrics: { read: true, write: true },
    }
    const approve = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${id}/approve`,
      headers: { cookie: adminCookie },
      payload: { permissions: override, dvClass: 'foreign' },
    })
    expect(approve.statusCode).toBe(201)
    expect(json(approve).permissions).toEqual(override)
    expect(json(approve).dvClass).toBe('foreign')

    // Both overrides are recorded on the application.
    const detail = await app.inject({
      method: 'GET',
      url: `/cvca/applications/${id}`,
      headers: { cookie: adminCookie },
    })
    expect(JSON.parse(json(detail).overridePermissionsJson as string)).toEqual(override)
    expect(json(detail).overrideDvClass).toBe('foreign')

    // The issued certificate carries the foreign DV role bits.
    const der = await app.inject({
      method: 'GET',
      url: `/cvca/certificates/${json(approve).id}.der`,
    })
    const dv = parseCvCertificate(new Uint8Array(der.rawPayload))
    expect(dv.dvClass).toBe('foreign')
    expect(dv.permissions).toEqual(override)
  })

  it('lets non-admins submit and see their own applications but not review them', async () => {
    const { app, oidc } = await harness()
    const userCookie = await loginCvca(app, oidc, OTHER_USER)
    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: userCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Own DV', permissions: PERMISSIONS },
    })
    expect(submit.statusCode).toBe(201)

    const list = await app.inject({
      method: 'GET',
      url: '/cvca/applications',
      headers: { cookie: userCookie },
    })
    expect(json(list).scope).toBe('own')
    expect(json(list).total).toBe(1)

    const approve = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${json(submit).id}/approve`,
      headers: { cookie: userCookie },
    })
    expect(approve.statusCode).toBe(403)
  })

  it('requires a session to submit and rejects an unauthenticated list', async () => {
    const { app } = await harness()
    const anon = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      payload: { keyMode: 'remote_generated', subjectCn: 'X', permissions: PERMISSIONS },
    })
    expect(anon.statusCode).toBe(401)

    const foreign = await app.inject({ method: 'GET', url: '/cvca/applications' })
    expect(foreign.statusCode).toBe(401)
  })

  it('exports a system-generated DV private key once and refuses for uploaded keys', async () => {
    const { app, adminCookie } = await harness()

    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: adminCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'Exportable DV',
        permissions: PERMISSIONS,
      },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${json(submit).id}/approve`,
      headers: { cookie: adminCookie },
    })
    const certId = json(approve).id as number

    // The application records the issued certificate and whether its key is
    // still available (for the in-detail one-time download).
    const detailBefore = await app.inject({
      method: 'GET',
      url: `/cvca/applications/${json(submit).id}`,
      headers: { cookie: adminCookie },
    })
    expect(json(detailBefore).dvCertId).toBe(certId)
    expect(json(detailBefore).hasPrivateKey).toBe(true)

    const key = await app.inject({
      method: 'GET',
      url: `/cvca/certificates/${certId}/private-key`,
      headers: { cookie: adminCookie },
    })
    expect(key.statusCode).toBe(200)
    expect(key.body).toContain('BEGIN PRIVATE KEY')

    const detailAfter = await app.inject({
      method: 'GET',
      url: `/cvca/applications/${json(submit).id}`,
      headers: { cookie: adminCookie },
    })
    expect(json(detailAfter).hasPrivateKey).toBe(false)

    const again = await app.inject({
      method: 'GET',
      url: `/cvca/certificates/${certId}/private-key`,
      headers: { cookie: adminCookie },
    })
    expect(again.statusCode).toBe(410)

    // Uploaded public keys have no private key to export.
    const keyPair = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const uploaded = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: adminCookie },
      payload: {
        keyMode: 'user_uploaded',
        subjectCn: 'Uploaded DV',
        publicKeyPem: derToPem(keyPair.spki, 'PUBLIC KEY'),
        permissions: PERMISSIONS,
      },
    })
    const uploadedApprove = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${json(uploaded).id}/approve`,
      headers: { cookie: adminCookie },
    })
    const noKey = await app.inject({
      method: 'GET',
      url: `/cvca/certificates/${json(uploadedApprove).id}/private-key`,
      headers: { cookie: adminCookie },
    })
    expect(noKey.statusCode).toBe(404)
    expect(json(noKey).error).toBe('no_private_key')
  })

  it('publishes the CVCA and DV certificate lists on the PKD', async () => {
    const { app, adminCookie } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: adminCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'PKD DV', permissions: PERMISSIONS },
    })
    await app.inject({
      method: 'POST',
      url: `/cvca/applications/${json(submit).id}/approve`,
      headers: { cookie: adminCookie },
    })

    const cvca = await app.inject({ method: 'GET', url: '/pkd/cvca' })
    expect(cvca.statusCode).toBe(200)
    expect((json(cvca).items as unknown[]).length).toBeGreaterThanOrEqual(1)

    const dvs = await app.inject({ method: 'GET', url: '/pkd/dvs' })
    expect(dvs.statusCode).toBe(200)
    const dvItems = json(dvs).items as {
      holderReference: string
      source: string
      dvClass: string
      permissions: unknown
    }[]
    // The CVCA-issued default (system) DV and the approved application DV.
    expect(dvItems.length).toBe(2)
    const system = dvItems.find((item) => item.source === 'system')
    expect(system).toBeDefined()
    const owned = dvItems.find((item) => item.source === 'owned')!
    expect(owned.dvClass).toBe('domestic')
    expect(owned.permissions).toEqual(PERMISSIONS)

    // The DER object is downloadable by id and is a CV certificate.
    const cvcaId = (json(cvca).items as { id: string }[])[0].id
    const object = await app.inject({ method: 'GET', url: `/pkd/objects/${cvcaId}.der` })
    expect(object.statusCode).toBe(200)
    expect(parseCvCertificate(new Uint8Array(object.rawPayload)).role).toBe('cvca')
  })

  it('lets a maintainer switch DV delegation and signs terminals accordingly', async () => {
    const { app, oidc, adminCookie } = await harness()
    const ownerCookie = await loginCvca(app, oidc, OTHER_USER)

    const before = await app.inject({
      method: 'GET',
      url: '/cvca/settings/mnt',
      headers: { cookie: ownerCookie },
    })
    expect(before.statusCode).toBe(200)
    // Default is delegation to the CVCA default (system) DV.
    expect(before.json().useNiaDv).toBe(true)
    expect(before.json().hasActiveDv).toBe(false)

    // Switching to an own DV is refused until one is approved.
    const refused = await app.inject({
      method: 'PUT',
      url: '/cvca/settings/mnt',
      headers: { cookie: ownerCookie },
      payload: { useNiaDv: false },
    })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toBe('no_active_dv')

    // A CVCA admin approves a DV application for this maintainer.
    const submit = await app.inject({
      method: 'POST',
      url: '/cvca/applications',
      headers: { cookie: ownerCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'DV-MNT own DV',
        permissions: PERMISSIONS,
      },
    })
    expect(submit.statusCode).toBe(201)
    const approve = await app.inject({
      method: 'POST',
      url: `/cvca/applications/${json(submit).id}/approve`,
      headers: { cookie: adminCookie },
    })
    expect(approve.statusCode).toBe(201)
    const ownDvId = json(approve).id as number

    const status = await app.inject({
      method: 'GET',
      url: '/cvca/settings/mnt',
      headers: { cookie: ownerCookie },
    })
    expect(status.json().hasActiveDv).toBe(true)

    // Terminal issuance now lives in the DV realm.  While the maintainer
    // delegates, the CVCA default DV signs; after switching, its own DV does.
    const applicant = await loginDv(app, oidc, OTHER_USER)
    const dvAdmin = await loginDv(app, oidc, DV_ADMIN)

    const delegated = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: applicant },
      payload: { keyMode: 'remote_generated', subjectCn: 'Delegated IS', permissions: PERMISSIONS },
    })
    expect(delegated.statusCode).toBe(201)
    const delegatedApprove = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${json(delegated).id}/approve`,
      headers: { cookie: dvAdmin },
    })
    expect(delegatedApprove.statusCode).toBe(201)
    expect(json(delegatedApprove).dvCertId).not.toBe(ownDvId)
    expect(json(delegatedApprove).mnt).toBe('DV-MNT')

    // After switching to the own DV, its certificate signs the terminal.
    const own = await app.inject({
      method: 'PUT',
      url: '/cvca/settings/mnt',
      headers: { cookie: ownerCookie },
      payload: { useNiaDv: false },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json().useNiaDv).toBe(false)

    const ownSubmit = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: applicant },
      payload: { keyMode: 'remote_generated', subjectCn: 'Own IS', permissions: PERMISSIONS },
    })
    const ownApprove = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${json(ownSubmit).id}/approve`,
      headers: { cookie: dvAdmin },
    })
    expect(json(ownApprove).dvCertId).toBe(ownDvId)
    expect(json(ownApprove).permissions).toEqual(PERMISSIONS)

    // The terminal chains to the DV that signed it (card-verifiable).
    const dvDer = await app.inject({ method: 'GET', url: `/cvca/certificates/${ownDvId}.der` })
    const dv = parseCvCertificate(new Uint8Array(dvDer.rawPayload))
    const terminalDer = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${json(ownSubmit).id}/certificate`,
      headers: { cookie: applicant },
    })
    const cert = parseCvCertificate(new Uint8Array(terminalDer.rawPayload))
    expect(cert.role).toBe('terminal')
    expect(cert.authorityReference).toBe(dv.holderReference)
    expect(await verifyCvCertificate(cert, await cvPublicKey(dv))).toBe(true)
  })

  it('rolls the CVCA key over with a link certificate', async () => {
    const { app, adminCookie, db } = await harness()
    const before = currentCvcaKey(db)!
    const rollover = await app.inject({
      method: 'POST',
      url: '/cvca/keys/rollover',
      headers: { cookie: adminCookie },
      payload: { confirm: true },
    })
    expect(rollover.statusCode).toBe(200)
    const after = currentCvcaKey(db)!
    expect(after.id).not.toBe(before.id)

    // The old key is retired, a link certificate is published and exactly one
    // key is current.  The list is available from the PKD rather than /cvca/keys.
    const rows = db.select().from(cvcaKey).all()
    expect(rows.some((row) => row.status === 'link')).toBe(true)
    expect(rows.filter((row) => row.isCurrent).length).toBe(1)

    const cvca = await app.inject({ method: 'GET', url: '/pkd/cvca' })
    const items = json(cvca).items as { id: string; status: string }[]
    expect(items.some((row) => row.status === 'link')).toBe(true)
    expect(items.some((row) => row.status === 'current')).toBe(true)
  })

  it('bootstrap the CVCA with an ECDSA key and exposes a trust anchor', async () => {
    const { db } = await harness()
    const row = currentCvcaKey(db)!
    expect(row.keyAlgorithm).toBe('ECDSA')
    const parsed = parseCvCertificate(new Uint8Array(row.certDer))
    expect(parsed.publicKey.algorithm).toBe('ec')
  })
})
