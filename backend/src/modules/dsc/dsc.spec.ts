import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { hexToBytes, parseCertificatePem, verifySod } from '@pkd42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import type { Db } from '../../db/client'
import { artifact, asConfig, signRequest } from '../../db/schema'
import { recordAsAdmin } from '../auth/authorization'
import { currentCscaKey } from '../csca/service'
import { mrzExpiry } from './build'
import type { DscService } from './service'

const CSCA_ADMIN = {
  sub: 'csca-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}
const NIA_DSC_ADMIN = {
  sub: 'nia-dsc-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-DSC-MNT', mnt_by: ['EXAMPLE-DSC-MNT'] },
}
const USER = {
  sub: 'user',
  email: 'user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}
const AS_REVIEWER = {
  sub: 'as1-reviewer',
  dn42: { asn: 4242420001, active_mnt: 'AS1-REV-MNT', mnt_by: ['AS1-REV-MNT'] },
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]).toString('base64')

function mrz(documentNumber: string): Record<string, unknown> {
  return {
    documentCode: 'P',
    issuingState: 'UDN',
    surname: 'DOE',
    givenNames: 'JANE',
    documentNumber,
    nationality: 'UDN',
    dateOfBirth: '900101',
    sex: 'F',
    personalNumber: '',
    optionalData: '',
  }
}

function payload(
  documentNumber = 'X1234567',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { mrz: mrz(documentNumber), dg2: { jpeg: JPEG, width: 45, height: 35 }, ...overrides }
}

interface Harness {
  app: FastifyInstance
  oidc: FakeOidc
  db: Db
  dsc: DscService
  cscaPem: string
}

async function harness(overrides: Record<string, string> = {}): Promise<Harness> {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { PKD42_CSCA_BOOTSTRAP: 'true', ...overrides })
  oidc.set('csca-client', { subject: CSCA_ADMIN.sub, claims: CSCA_ADMIN })
  oidc.set('dsc-client', { subject: USER.sub, claims: USER })
  return {
    app: built.app,
    oidc,
    db: built.dbHandle.db,
    dsc: built.dsc,
    cscaPem: currentCscaKey(built.dbHandle.db)!.certPem,
  }
}

async function login(
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
  const cookie = callback.cookies.find((entry) => entry.name === `pkd42_${realm}_sid`)!
  return `${cookie.name}=${cookie.value}`
}

interface ParsedPerso {
  dataGroups: Map<number, Uint8Array>
  sod?: Uint8Array
}

function parsePerso(text: string): ParsedPerso {
  const dataGroups = new Map<number, Uint8Array>()
  let sod: Uint8Array | undefined
  for (const line of text.split('\n')) {
    const dg = /^@dg (\d+) ([0-9A-F]+)$/.exec(line)
    if (dg) dataGroups.set(Number(dg[1]), hexToBytes(dg[2]))
    const s = /^@sod ([0-9A-F]+)$/.exec(line)
    if (s) sod = hexToBytes(s[1])
  }
  return { dataGroups, sod }
}

function artifactText(db: Db, requestId: number): string {
  const row = db.select().from(signRequest).where(eq(signRequest.id, requestId)).get()!
  const art = db.select().from(artifact).where(eq(artifact.id, row.resultArtifactId!)).get()!
  return readFileSync(art.path, 'utf8')
}

/** Submits a minimal request anonymously and returns its reference. */
async function submit(app: FastifyInstance, documentNumber: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/dsc/requests',
    payload: payload(documentNumber),
  })
  return response.json().reference as string
}

describe('M7 DSC signing service', () => {
  it('accepts an anonymous structured request and returns metadata', async () => {
    const { app } = await harness()
    const submit = await app.inject({ method: 'POST', url: '/dsc/requests', payload: payload() })
    expect(submit.statusCode).toBe(201)
    const reference = submit.json().reference as string
    expect(reference.length).toBeGreaterThan(20)

    const meta = await app.inject({ method: 'GET', url: `/dsc/requests/${reference}` })
    expect(meta.statusCode).toBe(200)
    expect(meta.json().status).toBe('submitted')
    expect(meta.json().dataGroups).toContain(1)

    const missing = await app.inject({ method: 'GET', url: '/dsc/requests/does-not-exist' })
    expect(missing.statusCode).toBe(404)
  })

  it('rejects an invalid payload and duplicate document numbers per AS', async () => {
    const { app, oidc } = await harness()
    const cookie = await login(app, oidc, 'dsc', 'dsc-client', USER)

    const bad = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('TOO-LONG-NUMBER'),
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('validation_failed')

    const first = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload(),
    })
    expect(first.statusCode).toBe(201)
    const second = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload(),
    })
    expect(second.statusCode).toBe(409)
    expect(second.json().error).toBe('document_number_conflict')
  })

  it('builds a verifiable perso on NIA approval', async () => {
    const { app, oidc, db, cscaPem } = await harness()
    const submit = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      payload: payload('X1234567', { security: { aa: true, caEcdh3des: true, caKeyId: 1 } }),
    })
    const reference = submit.json().reference as string
    const adminCookie = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: adminCookie },
    })
    expect(list.statusCode).toBe(200)
    const id = (list.json().items as { id: number }[])[0].id

    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)
    expect(approve.json().status).toBe('approved')

    const perso = parsePerso(artifactText(db, id))
    for (const dg of [1, 2, 14, 15]) expect(perso.dataGroups.has(dg)).toBe(true)
    expect(perso.sod).toBeTruthy()

    const result = await verifySod(perso.sod!, perso.dataGroups, [parseCertificatePem(cscaPem)])
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    void reference
  })

  it('scopes delegated AS reviewers to their own NIA-signed requests', async () => {
    const { app, oidc, db, dsc } = await harness()
    db.insert(asConfig)
      .values({ asn: 4242420001, useNiaDsc: true, updatedAt: new Date().toISOString() })
      .run()
    recordAsAdmin(db, 'AS1-REV-MNT', 4242420001)

    const reviewerCookie = await login(app, oidc, 'dsc', 'dsc-client', AS_REVIEWER)
    const userCookie = await login(app, oidc, 'dsc', 'dsc-client', USER)

    // The reviewer's AS submits a NIA-signed request.
    const own = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
      payload: payload('X1234567', { dscSelection: { mode: 'nia' } }),
    })
    const ownId = dsc.getByReference(own.json().reference as string)!.id

    // Another AS submits one too.
    const foreign = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('Z7654321', { dscSelection: { mode: 'nia' } }),
    })
    const foreignId = dsc.getByReference(foreign.json().reference as string)!.id

    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
    })
    expect(list.statusCode).toBe(200)
    const visible = (list.json().items as { id: number }[]).map((entry) => entry.id)
    expect(visible).toContain(ownId)
    expect(visible).not.toContain(foreignId)

    // Approving its own request succeeds.
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${ownId}/approve`,
      headers: { cookie: reviewerCookie },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    // Another AS's request is forbidden.
    const forbidden = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${foreignId}/approve`,
      headers: { cookie: reviewerCookie },
      payload: {},
    })
    expect(forbidden.statusCode).toBe(403)

    // A second own request may not be approved with global settings.
    const another = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
      payload: payload('Q1111111', { dscSelection: { mode: 'nia' } }),
    })
    const anotherId = dsc.getByReference(another.json().reference as string)!.id
    const settings = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${anotherId}/approve`,
      headers: { cookie: reviewerCookie },
      payload: { deliveryMode: 'reviewer' },
    })
    expect(settings.statusCode).toBe(403)
    expect(settings.json().error).toBe('forbidden_settings')
  })

  it('configures AS delegation and grants the reviewer scope', async () => {
    const { app, oidc, dsc } = await harness()
    const userCookie = await login(app, oidc, 'dsc', 'dsc-client', USER)

    // Without delegation the user has no review scope.
    const before = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('A1111111', { dscSelection: { mode: 'nia' } }),
    })
    const beforeId = dsc.getByReference(before.json().reference as string)!.id
    const forbidden = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${beforeId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(forbidden.statusCode).toBe(403)

    // Enable delegation for the AS.
    const enable = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/as',
      headers: { cookie: userCookie },
      payload: { useNiaDsc: true },
    })
    expect(enable.statusCode).toBe(200)
    const status = await app.inject({
      method: 'GET',
      url: '/dsc/settings/as',
      headers: { cookie: userCookie },
    })
    expect(status.json().useNiaDsc).toBe(true)

    // Now the AS admin can review its own NIA-signed request.
    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
    })
    expect((list.json().items as { id: number }[]).some((entry) => entry.id === beforeId)).toBe(
      true,
    )
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${beforeId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    // Disabling delegation removes the reviewer scope.
    await app.inject({
      method: 'PUT',
      url: '/dsc/settings/as',
      headers: { cookie: userCookie },
      payload: { useNiaDsc: false },
    })
    const next = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('B2222222', { dscSelection: { mode: 'nia' } }),
    })
    const nextId = dsc.getByReference(next.json().reference as string)!.id
    const denied = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${nextId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(denied.statusCode).toBe(403)
  })

  it('applies administrator security defaults and derives the DSC selection', async () => {
    const { app, oidc, db, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const first = await submit(app, 'D1111111')
    const firstRow = dsc.getByReference(first)!
    expect(firstRow.dscSelection).toBe('nia')
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${firstRow.id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const firstPerso = parsePerso(artifactText(db, firstRow.id))
    expect(firstPerso.dataGroups.has(14)).toBe(true)
    expect(firstPerso.dataGroups.has(15)).toBe(false)

    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { security: { aa: true } },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().security.aa).toBe(true)

    const second = await submit(app, 'D2222222')
    const secondRow = dsc.getByReference(second)!
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${secondRow.id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const secondPerso = parsePerso(artifactText(db, secondRow.id))
    expect(secondPerso.dataGroups.has(15)).toBe(true)
  })

  it('derives the document expiry from the issuing profile', async () => {
    const { app, oidc, db, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { validityYears: 5 },
    })

    const reference = await submit(app, 'E1111111')
    const row = dsc.getByReference(reference)!
    const payload = JSON.parse(row.payloadJson) as { mrz: { dateOfExpiry?: string } }
    expect(payload.mrz.dateOfExpiry).toBe(mrzExpiry(5))

    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${row.id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const dg1 = parsePerso(artifactText(db, row.id)).dataGroups.get(1)!
    expect(Buffer.from(dg1).toString('latin1')).toContain(mrzExpiry(5))
  })

  it('reports AS jurisdiction from the IP route table and settings', async () => {
    const { app, db } = await harness({
      PKD42_JURISDICTION_ROUTES: JSON.stringify([{ prefix: '10.0.0.0/8', asn: 4242420001 }]),
    })
    db.insert(asConfig)
      .values({ asn: 4242420001, useNiaDsc: false, updatedAt: new Date().toISOString() })
      .run()

    const inRange = await app.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '10.1.2.3',
    })
    expect(inRange.json()).toMatchObject({ asn: 4242420001, useNiaDsc: false, notice: true })

    const outOfRange = await app.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '192.0.2.1',
    })
    expect(outOfRange.json()).toMatchObject({ asn: null, notice: false })
  })
})
