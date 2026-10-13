import { describe, expect, it } from 'vitest'

import { isRevoked, parseCertificatePem, parseCrl, parseCrlPem } from '@epass42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import { crl as crlTable } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { currentCscaKey } from './service'

const ADMIN = {
  sub: 'csca-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}

async function setup() {
  const oidc = new FakeOidc()
  oidc.set('csca-client', { subject: ADMIN.sub, claims: ADMIN })
  const built = await makeTestApp(oidc, { csca: { bootstrap: true } })
  const { app, dbHandle, csca } = built
  const start = await app.inject({ method: 'GET', url: '/auth/csca/login' })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/csca/callback?code=x&state=${state}`,
  })
  const cookie = callback.cookies.find((entry) => entry.name === 'epass42_csca_sid')!
  return { app, db: dbHandle.db, csca, cookie: `${cookie.name}=${cookie.value}` }
}

async function issueDsc(
  csca: Awaited<ReturnType<typeof setup>>['csca'],
  db: Awaited<ReturnType<typeof setup>>['db'],
  name: string,
) {
  const key = currentCscaKey(db)!
  const pair = await csca.loadKeyPair(key)
  return csca.issueDsc({
    csca: key,
    cscaPair: pair,
    commonName: name,
    documentTypes: ['P'],
    validityYears: 5,
    privateKeyUsageYears: 1,
    source: 'owned',
    mnt: 'TEST-MNT',
    keyMode: 'remote_generated',
  })
}

describe('M6 CRL', () => {
  it('generates a verifiable CRL containing the revoked serial', async () => {
    const { db, csca } = await setup()
    const dsc = await issueDsc(csca, db, 'CRL Test DSC')
    csca.revoke(dsc.id, 'test')

    const row = await csca.generateCrl()
    const parsed = parseCrl(new Uint8Array(row.der))
    expect(isRevoked(parsed, dsc.serial)).toBeTruthy()

    const cscaCert = parseCertificatePem(currentCscaKey(db)!.certPem)
    expect(await parsed.verify({ publicKey: cscaCert.publicKey })).toBe(true)
  })

  it('increments the CRL number monotonically', async () => {
    const { csca } = await setup()
    expect((await csca.generateCrl()).crlNumber).toBe(1)
    expect((await csca.generateCrl()).crlNumber).toBe(2)
    const third = await csca.generateCrl()
    expect(third.crlNumber).toBe(3)
  })

  it('decides when to issue per the schedule', async () => {
    const { db, csca } = await setup()
    expect(csca.crlSchedule()).toEqual({ issue: true, reason: 'none' })

    const first = await csca.generateCrl()
    // Age the CRL by an hour: still fresh, no need to reissue.
    db.update(crlTable)
      .set({ thisUpdate: new Date(Date.now() - 3_600_000).toISOString() })
      .where(eq(crlTable.id, first.id))
      .run()
    expect(csca.crlSchedule().issue).toBe(false)

    // A revocation after the last CRL triggers a new one.
    const dsc = await issueDsc(csca, db, 'Scheduled Revocation')
    csca.revoke(dsc.id, 'test')
    expect(csca.crlSchedule().reason).toBe('revocation')
  })

  it('refreshes an aged CRL (max-age) when nothing changed', async () => {
    const { db, csca } = await setup()
    const only = await csca.generateCrl()
    db.update(crlTable)
      .set({ thisUpdate: new Date(Date.now() - 100 * 86_400_000).toISOString() })
      .where(eq(crlTable.id, only.id))
      .run()
    expect(csca.crlSchedule().reason).toBe('max-age')
  })

  it('serves the CRL over HTTP and regenerates on demand', async () => {
    const { app, cookie } = await setup()

    const missing = await app.inject({ method: 'GET', url: '/csca/crl.pem' })
    expect(missing.statusCode).toBe(404)

    const generate = await app.inject({
      method: 'POST',
      url: '/csca/crl/generate',
      headers: { cookie },
    })
    expect(generate.statusCode).toBe(201)
    expect(generate.json().crlNumber).toBe(1)

    const pem = await app.inject({ method: 'GET', url: '/csca/crl.pem' })
    expect(pem.statusCode).toBe(200)
    expect(pem.body).toContain('BEGIN X509 CRL')

    const der = await app.inject({ method: 'GET', url: '/csca/crl.der' })
    expect(der.statusCode).toBe(200)
    expect(der.rawPayload[0]).toBe(0x30)
  })

  it('regenerates the CRL automatically when a certificate is revoked', async () => {
    const { app, cookie } = await setup()
    // Seed a CRL.
    await app.inject({ method: 'POST', url: '/csca/crl/generate', headers: { cookie } })

    // Issue and revoke via the API.
    const submit = await app.inject({
      method: 'POST',
      url: '/csca/applications',
      headers: { cookie },
      payload: { keyMode: 'remote_generated', subjectCn: 'Auto CRL DSC', documentType: 'P' },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/csca/applications/${submit.json().id}/approve`,
      headers: { cookie },
    })
    const certId = approve.json().id as number
    const serial = approve.json().serial as string
    await app.inject({
      method: 'POST',
      url: `/csca/certificates/${certId}/revoke`,
      headers: { cookie },
      payload: { reason: 'test' },
    })

    const pem = await app.inject({ method: 'GET', url: '/csca/crl.pem' })
    expect(pem.statusCode).toBe(200)
    const parsed = parseCrlPem(pem.body)
    expect(isRevoked(parsed, serial)).toBeTruthy()
  })
})
