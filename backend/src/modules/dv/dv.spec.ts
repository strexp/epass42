import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { parseCvCertificate } from '@epass42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import { cvcaKey, dvCert } from '../../db/schema'
import type { Db } from '../../db/client'
import { currentDefaultDv, type CvcaService } from '../cvca/service'

const DV_ADMIN = {
  sub: 'dv-admin',
  name: 'DV Admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-DV-MNT', mnt_by: ['EXAMPLE-DV-MNT'] },
}
const DV_USER = {
  sub: 'dv-user',
  name: 'DV User',
  dn42: { asn: 4242420002, active_mnt: 'DV-MNT', mnt_by: ['DV-MNT'] },
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
  service: CvcaService
}

async function harness(): Promise<Harness> {
  const oidc = new FakeOidc()
  oidc.set('dv-client', { subject: DV_ADMIN.sub, claims: DV_ADMIN })
  const built = await makeTestApp(oidc, { cvca: { bootstrap: true } })
  const app = built.app
  const adminCookie = await loginDv(app, oidc, DV_ADMIN)
  return { app, oidc, adminCookie, db: built.dbHandle.db, service: built.cvca }
}

/** Logs in to the DV realm as a specific identity. */
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

describe('M18 DV realm terminal certificates', () => {
  it('issues terminal certificates through a reviewed application', async () => {
    const { app, oidc, adminCookie } = await harness()
    const ownerCookie = await loginDv(app, oidc, DV_USER)

    const submit = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Border IS', permissions: PERMISSIONS },
    })
    expect(submit.statusCode).toBe(201)
    const id = json(submit).id as number

    // Only DV administrators may review.
    const refused = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${id}/approve`,
      headers: { cookie: ownerCookie },
    })
    expect(refused.statusCode).toBe(403)

    // The applicant sees only its own applications.
    const list = await app.inject({
      method: 'GET',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
    })
    expect(list.statusCode).toBe(200)
    expect(json(list).scope).toBe('own')

    // Approval issues a terminal certificate (no override: request as-is).
    const approve = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${id}/approve`,
      headers: { cookie: adminCookie },
    })
    expect(approve.statusCode).toBe(201)
    const meta = json(approve)
    expect(meta.permissions).toEqual(PERMISSIONS)
    expect(meta.mnt).toBe('DV-MNT')

    // The issued object is a terminal role card-verifiable certificate.
    const der = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${id}/certificate`,
      headers: { cookie: ownerCookie },
    })
    expect(der.statusCode).toBe(200)
    expect(parseCvCertificate(new Uint8Array(der.rawPayload)).role).toBe('terminal')

    const detail = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${id}`,
      headers: { cookie: ownerCookie },
    })
    expect(json(detail).status).toBe('approved')
    expect(json(detail).terminalCertId).toBe(meta.id)
    expect(json(detail).hasPrivateKey).toBe(true)

    // The one-time private key is claimed from the application detail.
    const key = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${id}/private-key`,
      headers: { cookie: ownerCookie },
    })
    expect(key.statusCode).toBe(200)
    expect(key.body).toContain('BEGIN PRIVATE KEY')
    const consumed = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${id}/private-key`,
      headers: { cookie: ownerCookie },
    })
    expect(consumed.statusCode).toBe(410)
    const afterKey = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${id}`,
      headers: { cookie: ownerCookie },
    })
    expect(json(afterKey).hasPrivateKey).toBe(false)

    // An approval override replaces the requested permissions.
    const override = {
      epassport: { dg3: false, dg4: false },
      travel: { read: true, write: false },
      visa: { read: false, write: false },
      biometrics: { read: false, write: false },
    }
    const submit2 = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
      payload: {
        keyMode: 'remote_generated',
        subjectCn: 'Overridden IS',
        permissions: PERMISSIONS,
      },
    })
    const approve2 = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${json(submit2).id}/approve`,
      headers: { cookie: adminCookie },
      payload: { permissions: override },
    })
    expect(approve2.statusCode).toBe(201)
    expect(json(approve2).permissions).toEqual(override)

    // Rejection records the reason.
    const submit3 = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Rejected IS', permissions: PERMISSIONS },
    })
    const reject = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${json(submit3).id}/reject`,
      headers: { cookie: adminCookie },
      payload: { reason: 'not needed' },
    })
    expect(reject.statusCode).toBe(200)
    const detail3 = await app.inject({
      method: 'GET',
      url: `/dv/terminal-applications/${json(submit3).id}`,
      headers: { cookie: ownerCookie },
    })
    expect(json(detail3).status).toBe('rejected')
    expect(json(detail3).rejectReason).toBe('not needed')
  })

  it('requires a DV realm session', async () => {
    const { app } = await harness()
    const anonymous = await app.inject({ method: 'GET', url: '/dv/terminal-applications' })
    expect(anonymous.statusCode).toBe(401)
  })
  it('rotates the NIA DV and retires the previous certificate', async () => {
    const { app, adminCookie, db } = await harness()
    const before = currentDefaultDv(db)!
    const rotate = await app.inject({
      method: 'POST',
      url: '/dv/nia-dv/rotate',
      headers: { cookie: adminCookie },
      payload: { confirm: true },
    })
    expect(rotate.statusCode).toBe(200)
    expect(json(rotate).previous).toBe(before.id)
    expect(json(rotate).current).not.toBe(before.id)
    const oldRow = db.select().from(dvCert).where(eq(dvCert.id, before.id)).get()!
    expect(oldRow.status).toBe('retired')
    const current = currentDefaultDv(db)!
    expect(current.id).toBe(json(rotate).current)
    expect(current.status).toBe('active')
  })

  it('blocks NIA DV rotation when the CVCA has expired', async () => {
    const { app, adminCookie, db } = await harness()
    db.update(cvcaKey).set({ notAfter: '2000-01-01T00:00:00.000Z' }).run()
    const rotate = await app.inject({
      method: 'POST',
      url: '/dv/nia-dv/rotate',
      headers: { cookie: adminCookie },
      payload: { confirm: true },
    })
    expect(rotate.statusCode).toBe(409)
    expect(json(rotate).error).toBe('cvca_expired')
  })

  it('blocks all terminal applications and approvals when the NIA DV has expired', async () => {
    const { app, oidc, adminCookie, db } = await harness()
    const ownerCookie = await loginDv(app, oidc, DV_USER)
    const submit = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Pending IS', permissions: PERMISSIONS },
    })
    expect(submit.statusCode).toBe(201)
    const id = json(submit).id as number

    db.update(dvCert)
      .set({ notAfter: '2000-01-01T00:00:00.000Z' })
      .where(eq(dvCert.source, 'system'))
      .run()

    const status = await app.inject({ method: 'GET', url: '/dv/status' })
    expect(status.statusCode).toBe(200)
    expect(json(status).canIssueTerminals).toBe(false)
    expect((json(status).niaDv as { expired: boolean }).expired).toBe(true)

    const blockedSubmit = await app.inject({
      method: 'POST',
      url: '/dv/terminal-applications',
      headers: { cookie: ownerCookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Blocked IS', permissions: PERMISSIONS },
    })
    expect(blockedSubmit.statusCode).toBe(409)
    expect(json(blockedSubmit).error).toBe('nia_dv_expired')

    const blockedApprove = await app.inject({
      method: 'POST',
      url: `/dv/terminal-applications/${id}/approve`,
      headers: { cookie: adminCookie },
    })
    expect(blockedApprove.statusCode).toBe(409)
    expect(json(blockedApprove).error).toBe('nia_dv_expired')
  })

  it('refuses NIA DV rotation to non-admins', async () => {
    const { app, oidc } = await harness()
    const cookie = await loginDv(app, oidc, DV_USER)
    const rotate = await app.inject({
      method: 'POST',
      url: '/dv/nia-dv/rotate',
      headers: { cookie },
      payload: { confirm: true },
    })
    expect(rotate.statusCode).toBe(403)
  })
})
