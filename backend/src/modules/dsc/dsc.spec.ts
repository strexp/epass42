import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'

import {
  derOid,
  hexToBytes,
  parseCertificatePem,
  parseTlv,
  SECURITY_INFO_OIDS,
  verifySod,
} from '@epass42/pki'
import { FakeOidc, makeTestApp, staticMntResolver } from '../../test-support'
import type { Db } from '../../db/client'
import { mntConfig } from '../../db/schema'
import { recordAsAdmin } from '../auth/authorization'
import { currentCscaKey, type CscaService } from '../csca/service'
import { mrzExpiry } from './build'
import type { DscService } from './service'
import type { MntResolver } from '../jurisdiction/whois'

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

/** A minimal MRZ record for a concrete document type. */
function mrzOfType(documentNumber: string, documentCode: 'P' | 'ID' | 'IP') {
  return { ...mrz(documentNumber), documentCode }
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
  csca: CscaService
  cscaPem: string
}

async function harness(
  overrides: Record<string, unknown> = {},
  resolver: MntResolver = staticMntResolver(),
): Promise<Harness> {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { csca: { bootstrap: true }, ...overrides }, resolver)
  oidc.set('csca-client', { subject: CSCA_ADMIN.sub, claims: CSCA_ADMIN })
  oidc.set('dsc-client', { subject: USER.sub, claims: USER })
  return {
    app: built.app,
    oidc,
    db: built.dbHandle.db,
    dsc: built.dsc,
    csca: built.csca,
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
  const cookie = callback.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)!
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

function artifactText(dsc: DscService, reference: string): string {
  const row = dsc.getByReference(reference)!
  return dsc.readArtifact(row)
}

/** A fresh applicant identity (unique subject/ASN/MNT) so each submit has its own slot. */
let applicantSeq = 0
function applicantClaims(): Record<string, unknown> {
  applicantSeq += 1
  const mnt = `APP-${applicantSeq}-MNT`
  return {
    sub: `applicant-${applicantSeq}`,
    dn42: { asn: 4242421000 + applicantSeq, active_mnt: mnt, mnt_by: [mnt] },
  }
}

/** Logs in a fresh applicant, returning its session cookie. */
async function applicant(app: FastifyInstance, oidc: FakeOidc): Promise<string> {
  return login(app, oidc, 'dsc', 'dsc-client', applicantClaims())
}

/** Submits a minimal request as a fresh applicant and returns its reference. */
async function submit(
  app: FastifyInstance,
  oidc: FakeOidc,
  documentNumber: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const cookie = await applicant(app, oidc)
  const response = await app.inject({
    method: 'POST',
    url: '/dsc/requests',
    headers: { cookie },
    payload: payload(documentNumber, overrides),
  })
  expect(response.statusCode).toBe(201)
  return response.json().reference as string
}

describe('M7 DSC signing service', () => {
  it('requires an authenticated applicant to submit and read a request', async () => {
    const { app, oidc } = await harness()

    // Anonymous submission is rejected.
    const anon = await app.inject({ method: 'POST', url: '/dsc/requests', payload: payload() })
    expect(anon.statusCode).toBe(401)

    const cookie = await applicant(app, oidc)
    const created = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload(),
    })
    expect(created.statusCode).toBe(201)
    const reference = created.json().reference as string
    expect(reference.length).toBeGreaterThan(20)

    // The owner may read the metadata by reference.
    const meta = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}`,
      headers: { cookie },
    })
    expect(meta.statusCode).toBe(200)
    expect(meta.json().status).toBe('submitted')
    expect(meta.json().dataGroups).toContain(1)

    // Anonymous lookups are rejected; a missing reference is not found.
    const anonMeta = await app.inject({ method: 'GET', url: `/dsc/requests/${reference}` })
    expect(anonMeta.statusCode).toBe(401)
    const missing = await app.inject({
      method: 'GET',
      url: '/dsc/requests/does-not-exist',
      headers: { cookie },
    })
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
    const { app, oidc, dsc, cscaPem } = await harness()
    const cookie = await applicant(app, oidc)
    const submit = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('X1234567', { security: { aa: { enabled: true } } }),
    })
    const reference = submit.json().reference as string
    const adminCookie = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: adminCookie },
    })
    expect(list.statusCode).toBe(200)
    const id = (list.json().items as { reference: string }[])[0].reference

    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)
    expect(approve.json().status).toBe('approved')

    const perso = parsePerso(artifactText(dsc, id))
    for (const dg of [1, 2, 14, 15]) expect(perso.dataGroups.has(dg)).toBe(true)
    expect(perso.sod).toBeTruthy()

    const result = await verifySod(perso.sod!, perso.dataGroups, [parseCertificatePem(cscaPem)])
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    void reference
  })

  it('signs a TD1 ID card with the built-in P+I DSC', async () => {
    const { app, oidc, dsc, cscaPem } = await harness()
    const cookie = await applicant(app, oidc)
    const submit = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('ID1234567', { mrz: mrzOfType('ID1234567', 'ID') }),
    })
    expect(submit.statusCode).toBe(201)
    const reference = submit.json().reference as string

    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    const perso = parsePerso(artifactText(dsc, reference))
    const dg1 = parseTlv(perso.dataGroups.get(1)!)
    const mrz = dg1.children[0]!.value
    expect(mrz).toHaveLength(90)
    expect(Buffer.from(mrz).toString('latin1').slice(0, 2)).toBe('ID')

    const result = await verifySod(perso.sod!, perso.dataGroups, [parseCertificatePem(cscaPem)])
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('refuses to sign an I* document when the NIA DSC is configured for P only', async () => {
    const { app, oidc, dsc } = await harness({
      csca: { bootstrap: true, niaDsc: { documentTypes: ['P'] } },
    })
    const cookie = await applicant(app, oidc)
    const submit = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('IDPONLY1', { mrz: mrzOfType('IDPONLY1', 'ID') }),
    })
    expect(submit.statusCode).toBe(201)
    const row = dsc.getByReference(submit.json().reference as string)!
    await expect(dsc.approve(row, null)).rejects.toMatchObject({
      code: 'dsc_document_type_mismatch',
    })
  })

  it('refuses to sign with an owned DSC that does not authorize the document type', async () => {
    const { app, oidc, dsc, db, csca } = await harness()
    const cscaRow = currentCscaKey(db)!
    const cscaPair = await csca.loadKeyPair(cscaRow)
    const owned = await csca.issueDsc({
      csca: cscaRow,
      cscaPair,
      commonName: 'Owned P-only DSC',
      documentTypes: ['P'],
      validityYears: 1,
      privateKeyUsageYears: 1,
      source: 'owned',
      mnt: 'USER-MNT',
      keyMode: 'remote_generated',
    })

    const cookie = await login(app, oidc, 'dsc', 'dsc-client', USER)
    const submit = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('IDOWNED1', {
        mrz: mrzOfType('IDOWNED1', 'ID'),
        dscSelection: { mode: 'owned', dscCertId: owned.id },
      }),
    })
    expect(submit.statusCode).toBe(201)
    const row = dsc.getByReference(submit.json().reference as string)!
    await expect(dsc.approve(row, null)).rejects.toMatchObject({
      code: 'dsc_document_type_mismatch',
    })
  })

  it('personalises a CVCA trust point and id-TA when Terminal Authentication is enabled', async () => {
    const { app, oidc, dsc } = await harness({
      cvca: { bootstrap: true },
      issuing: { security: { ta: { enabled: true } } },
    })
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const reference = await submit(app, oidc, 'TA1111111')
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    const text = artifactText(dsc, reference)
    expect(text).toMatch(/^@ta-date \d{6}$/m)
    expect(text).toMatch(/^@cvca 04[0-9A-F]+ \S+ \d{6} [0-9A-F]{8}$/m)

    // DG14 advertises TerminalAuthenticationInfo (id-TA version 1).
    const dg14 = parsePerso(text).dataGroups.get(14)!
    const idTa = derOid('0.4.0.127.0.7.2.2.2')
    expect(Buffer.from(dg14).includes(Buffer.from(idTa))).toBe(true)
  })

  it('personalises an RSA-PSS CVCA trust point when the CVCA is RSA', async () => {
    const { app, oidc, dsc } = await harness({
      cvca: { bootstrap: true, algorithm: 'rsa' },
      issuing: { security: { ta: { enabled: true } } },
    })
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const reference = await submit(app, oidc, 'TARSA111')
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)
    const text = artifactText(dsc, reference)
    expect(text).toMatch(/^@cvca-rsa [0-9A-F]+ [0-9A-F]+ \S+ \d{6} [0-9A-F]{8}$/m)
    expect(text).not.toMatch(/^@cvca 04/m)
  })

  it('personalises the ECDSA AA variant and the CA AES-128 profile', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const reference = await submit(app, oidc, 'AAE11111', {
      security: { aa: { enabled: true, algorithm: 'ecdsa' }, ca: { enabled: true } },
    })
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    const text = artifactText(dsc, reference)
    expect(text).toMatch(/^@aa-alg ecdsa$/m)
    expect(text).toMatch(/^@aa-ec [0-9A-F]{64}$/m)
    expect(text).not.toMatch(/^@aa [0-9A-F]+$/m)

    // EF.CardAccess advertises both CA profiles and the ECDSA AA OID.
    const cardAccess = hexToBytes(/^@cardaccess ([0-9A-F]+)$/m.exec(text)![1])
    expect(
      Buffer.from(cardAccess).includes(Buffer.from(derOid(SECURITY_INFO_OIDS.caEcdhAes128))),
    ).toBe(true)
    expect(Buffer.from(cardAccess).includes(Buffer.from(derOid('0.4.0.127.0.7.1.1.4.1.3')))).toBe(
      true,
    )
    // DG15 is an EC SubjectPublicKeyInfo (RFC 5480).
    const dg15 = parsePerso(text).dataGroups.get(15)!
    expect(Buffer.from(dg15).includes(Buffer.from(derOid('1.2.840.10045.2.1')))).toBe(true)
  })

  it('signs the SOD with an ECDSA DSC under an ECDSA CSCA', async () => {
    const { app, oidc, dsc, cscaPem } = await harness({
      csca: { bootstrap: true, algorithm: 'ecdsa', niaDsc: { algorithm: 'ecdsa' } },
    })
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const reference = await submit(app, oidc, 'ECDSA111')
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    const perso = parsePerso(artifactText(dsc, reference))
    const result = await verifySod(perso.sod!, perso.dataGroups, [parseCertificatePem(cscaPem)])
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('personalises the optional PACE Card Access Number (CAN) for LDS1 only', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    // Emit an LDS2 application too, to show @can stays in the LDS1 section.
    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { lds2: { enabled: true, roles: ['travel'] } },
    })
    expect(update.statusCode).toBe(200)

    // Without a CAN there is no @can directive.
    const plain = await submit(app, oidc, 'C1111111')
    const plainId = plain
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${plainId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(artifactText(dsc, plainId)).not.toMatch(/^@can /m)

    // With a CAN it is written once, in the LDS1 (master file) section.
    const canCookie = await applicant(app, oidc)
    const withCan = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: canCookie },
      payload: payload('C2222222', { can: '123456' }),
    })
    expect(withCan.statusCode).toBe(201)
    const canId = withCan.json().reference as string
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${canId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const perso = artifactText(dsc, canId)
    const lds1 = perso.split('@instance A0000002472001')[0]!
    expect(lds1).toMatch(/^@can 123456$/m)
    expect(perso.match(/^@can /gm) ?? []).toHaveLength(1)
  })

  it('rejects a malformed Card Access Number', async () => {
    const { app } = await harness()
    for (const can of ['12345', '1234567', 'abcdef']) {
      const response = await app.inject({
        method: 'POST',
        url: '/dsc/requests',
        payload: payload('C3333333', { can }),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('validation_failed')
    }
  })

  it('scopes delegated maintainer reviewers to their own NIA-signed requests', async () => {
    const { app, oidc, db } = await harness()
    db.insert(mntConfig)
      .values({ mnt: 'AS1-REV-MNT', useNiaDsc: true, updatedAt: new Date().toISOString() })
      .run()
    recordAsAdmin(db, 'AS1-REV-MNT')

    const reviewerCookie = await login(app, oidc, 'dsc', 'dsc-client', AS_REVIEWER)
    const userCookie = await login(app, oidc, 'dsc', 'dsc-client', USER)

    // The reviewer's AS submits a NIA-signed request.
    const own = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
      payload: payload('X1234567', { dscSelection: { mode: 'nia' } }),
    })
    const ownId = own.json().reference as string

    // Another AS submits one too.
    const foreign = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('Z7654321', { dscSelection: { mode: 'nia' } }),
    })
    const foreignId = foreign.json().reference as string

    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
    })
    expect(list.statusCode).toBe(200)
    const visible = (list.json().items as { reference: string }[]).map((entry) => entry.reference)
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

    // A second request may be submitted while a passport is active: approving
    // the re-issuance would supersede the current passport.
    const another = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
      payload: payload('Q1111111', { dscSelection: { mode: 'nia' } }),
    })
    expect(another.statusCode).toBe(201)
    const anotherId = another.json().reference as string

    // A second own request may not be approved with global settings.
    const settings = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${anotherId}/approve`,
      headers: { cookie: reviewerCookie },
      payload: { deliveryMode: 'reviewer' },
    })
    expect(settings.statusCode).toBe(403)
    expect(settings.json().error).toBe('forbidden_settings')
  })

  it('configures maintainer delegation and grants the reviewer scope', async () => {
    const { app, oidc } = await harness()
    const userCookie = await login(app, oidc, 'dsc', 'dsc-client', USER)

    // Without delegation the user has no review scope.
    const before = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('A1111111', { dscSelection: { mode: 'nia' } }),
    })
    const beforeId = before.json().reference as string
    const forbidden = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${beforeId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(forbidden.statusCode).toBe(403)

    // Enable delegation for the maintainer.
    const enable = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/mnt',
      headers: { cookie: userCookie },
      payload: { useNiaDsc: true },
    })
    expect(enable.statusCode).toBe(200)
    const status = await app.inject({
      method: 'GET',
      url: '/dsc/settings/mnt',
      headers: { cookie: userCookie },
    })
    expect(status.json().useNiaDsc).toBe(true)

    // Now the maintainer can review its own NIA-signed request.
    const list = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
    })
    expect(
      (list.json().items as { reference: string }[]).some((entry) => entry.reference === beforeId),
    ).toBe(true)
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${beforeId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(approve.statusCode).toBe(200)

    // The owner can revoke the approved passport explicitly.
    const revoke = await app.inject({
      method: 'POST',
      url: `/dsc/passports/${beforeId}/revoke`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(revoke.statusCode).toBe(200)

    // Disabling delegation removes the reviewer scope.
    await app.inject({
      method: 'PUT',
      url: '/dsc/settings/mnt',
      headers: { cookie: userCookie },
      payload: { useNiaDsc: false },
    })
    const next = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: userCookie },
      payload: payload('B2222222', { dscSelection: { mode: 'nia' } }),
    })
    const nextId = next.json().reference as string
    const denied = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${nextId}/approve`,
      headers: { cookie: userCookie },
      payload: {},
    })
    expect(denied.statusCode).toBe(403)
  })

  it('applies administrator security defaults and derives the DSC selection', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const first = await submit(app, oidc, 'D1111111')
    const firstRow = dsc.getByReference(first)!
    expect(firstRow.dscSelection).toBe('nia')
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${firstRow.reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const firstPerso = parsePerso(artifactText(dsc, firstRow.reference))
    // A PACE-only document keeps SecurityInfos in EF.CardAccess, so no DG14.
    expect(firstPerso.dataGroups.has(14)).toBe(false)
    expect(firstPerso.dataGroups.has(15)).toBe(false)

    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { security: { aa: { enabled: true } } },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().security.aa.enabled).toBe(true)

    const second = await submit(app, oidc, 'D2222222')
    const secondRow = dsc.getByReference(second)!
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${secondRow.reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const secondPerso = parsePerso(artifactText(dsc, secondRow.reference))
    expect(secondPerso.dataGroups.has(14)).toBe(true)
    expect(secondPerso.dataGroups.has(15)).toBe(true)
  })

  it('carries the CA public key in DG14 alongside EF.CardSecurity', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { security: { ca: { enabled: true } } },
    })
    expect(update.statusCode).toBe(200)

    const reference = await submit(app, oidc, 'C1111111')
    const row = dsc.getByReference(reference)!
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${row.reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    const perso = parsePerso(artifactText(dsc, row.reference))
    const dg14 = perso.dataGroups.get(14)
    expect(dg14).toBeTruthy()
    // DG14 = 6E { SET OF SecurityInfo } (Doc 9303-10 §4.7.14).
    const dg = parseTlv(dg14!)
    expect(dg.tag).toBe(0x6e)
    const securityInfos = dg.children[0]
    expect(securityInfos.tag).toBe(0x31)
    // The set repeats EF.CardAccess and adds the chip's static CA public key,
    // i.e. the same SecurityInfos EF.CardSecurity signs.
    const caOid = derOid(SECURITY_INFO_OIDS.idPkEcdh).slice(2)
    const hasCaPublicKey = securityInfos.children.some(
      (info) =>
        info.tag === 0x30 &&
        info.children[0]?.tag === 0x06 &&
        Buffer.from(info.children[0].value).equals(Buffer.from(caOid)),
    )
    expect(hasCaPublicKey).toBe(true)
  })

  it('derives the document expiry from the issuing profile', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { validityYears: 5 },
    })

    const reference = await submit(app, oidc, 'E1111111')
    const row = dsc.getByReference(reference)!
    const payload = JSON.parse(row.payloadJson) as { mrz: { dateOfExpiry?: string } }
    expect(payload.mrz.dateOfExpiry).toBe(mrzExpiry(5))

    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${row.reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const dg1 = parsePerso(artifactText(dsc, row.reference)).dataGroups.get(1)!
    expect(Buffer.from(dg1).toString('latin1')).toContain(mrzExpiry(5))
  })

  it('rejects an oversized DG2 face', async () => {
    const { app, oidc } = await harness()
    const cookie = await applicant(app, oidc)
    const big = Buffer.alloc(20000, 1).toString('base64')
    const response = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: { ...payload('G1111111'), dg2: { jpeg: big, width: 100, height: 125 } },
    })
    expect(response.statusCode).toBe(413)
    expect(response.json().error).toBe('dg2_too_large')
  })

  it('emits empty LDS2 applications only when enabled', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    // Default: LDS1 only, no LDS2 section.
    const first = await submit(app, oidc, 'H1111111')
    const firstId = first
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${firstId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(artifactText(dsc, firstId)).not.toMatch(/^@lds2 /m)

    // Enable empty LDS2 applications for Travel Records.
    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { lds2: { enabled: true, roles: ['travel'] } },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().lds2).toEqual({ enabled: true, roles: ['travel'] })

    const second = await submit(app, oidc, 'H2222222')
    const secondId = second
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${secondId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const perso = artifactText(dsc, secondId)
    expect(perso).toMatch(/^@lds2 travel$/m)
    expect(perso).toMatch(/^@ca /m)
    expect(perso).toMatch(/^@cardsecurity /m)
    expect(perso).not.toMatch(/^@record /m)
    expect(perso).not.toMatch(/^@transparent /m)
  })

  it('advertises Chip Authentication on LDS1 when enabled', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    // Default: LDS1 is PACE + AA only, with no CA key or EF.CardSecurity.
    const first = await submit(app, oidc, 'H3333333')
    const firstId = first
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${firstId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const firstPerso = artifactText(dsc, firstId)
    expect(firstPerso).not.toMatch(/^@ca /m)
    expect(firstPerso).not.toMatch(/^@cardsecurity /m)

    // Enable Chip Authentication for the LDS1 document.
    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { security: { ca: { enabled: true } } },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().security.ca.enabled).toBe(true)

    const second = await submit(app, oidc, 'H4444444')
    const secondId = second
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${secondId}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    const secondPerso = artifactText(dsc, secondId)
    const lds1 = secondPerso.split('@instance A0000002472001')[0]!
    expect(lds1).toMatch(/^@ca /m)
    expect(lds1).toMatch(/^@cardsecurity /m)
    expect(secondPerso).not.toMatch(/^@lds2 /m)
  })

  it('shares one Chip Authentication key pair across LDS1 and LDS2', async () => {
    const { app, oidc, dsc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: { lds2: { enabled: true, roles: ['travel'] } },
    })
    expect(update.statusCode).toBe(200)

    const reference = await submit(app, oidc, 'H5555555')
    const id = reference
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    const perso = artifactText(dsc, id)
    const lds1 = perso.split('@instance A0000002472001')[0]!
    // One CA key pair and one EF.CardSecurity live in the master file, so the
    // LDS1 section carries the same values as the LDS2 application.
    const caLines = perso.match(/^@ca [0-9A-F]+$/gm) ?? []
    expect(caLines).toHaveLength(2)
    expect(new Set(caLines).size).toBe(1)
    expect(lds1).toMatch(/^@ca /m)
    expect(lds1).toMatch(/^@cardsecurity /m)
    expect(perso).toMatch(/^@lds2 travel$/m)
  })

  it('rejects Chip Authentication without any PACE profile', async () => {
    const { app, oidc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: {
        security: {
          pace: { ecdhGm3des: false, ecdhGmAes128: false },
          ca: { enabled: true },
        },
      },
    })
    expect(update.statusCode).toBe(200)

    const reference = await submit(app, oidc, 'H6666666')
    const id = reference
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(400)
    expect(approve.json().error).toBe('pace_required')
  })

  it('requires at least one security mechanism', async () => {
    const { app, oidc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const update = await app.inject({
      method: 'PUT',
      url: '/dsc/settings/issuing-profile',
      headers: { cookie: admin },
      payload: {
        security: {
          pace: { ecdhGm3des: false, ecdhGmAes128: false },
          aa: { enabled: false },
          ca: { enabled: false },
        },
      },
    })
    expect(update.statusCode).toBe(200)

    const reference = await submit(app, oidc, 'H7777777')
    const id = reference
    const approve = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${id}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approve.statusCode).toBe(400)
    expect(approve.json().error).toBe('no_security_mechanism')
  })

  it('server-sets the MRZ nationality', async () => {
    const { app, oidc, dsc } = await harness()
    const cookie = await applicant(app, oidc)
    const response = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: { ...payload('N1111111'), mrz: { ...mrz('N1111111'), nationality: 'AAA' } },
    })
    expect(response.statusCode).toBe(201)
    const row = dsc.getByReference(response.json().reference as string)!
    const stored = JSON.parse(row.payloadJson) as { mrz: { nationality: string } }
    expect(stored.mrz.nationality).toBe('UDN')
  })

  it('reports maintainer jurisdiction from whois and settings', async () => {
    const { app, db, oidc } = await harness(
      {},
      staticMntResolver({ '10.1.2.3': ['AS1-MNT'], '192.0.2.1': [] }),
    )
    db.insert(mntConfig)
      .values({ mnt: 'AS1-MNT', useNiaDsc: false, updatedAt: new Date().toISOString() })
      .run()

    const inRange = await app.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '10.1.2.3',
    })
    expect(inRange.json()).toMatchObject({ mnts: ['AS1-MNT'], useNiaDsc: false, notice: true })

    const outOfRange = await app.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      remoteAddress: '192.0.2.1',
    })
    expect(outOfRange.json()).toMatchObject({ mnts: [], notice: false })

    // A signed-in applicant on the NIA route sees who reviews: their own MNT
    // plus the DSC administrators.
    const user = await login(app, oidc, 'dsc', 'dsc-client', USER)
    const signedIn = await app.inject({
      method: 'GET',
      url: '/dsc/jurisdiction',
      headers: { cookie: user },
    })
    const body = signedIn.json() as { notice: boolean; reviewers: string[] }
    expect(body.notice).toBe(false)
    expect(body.reviewers).toContain('USER-MNT')
    expect(body.reviewers).toContain('EXAMPLE-DSC-MNT')
  })

  it('lets the owner view status/preview and reveal by reference', async () => {
    const { app, oidc } = await harness()
    const user = await login(app, oidc, 'dsc', 'dsc-client', USER)
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)

    const created = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: user },
      payload: payload('F1111111'),
    })
    const reference = created.json().reference as string
    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    const status = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}`,
      headers: { cookie: user },
    })
    expect(status.statusCode).toBe(200)
    expect(status.json().status).toBe('approved')

    const preview = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}/preview`,
      headers: { cookie: user },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json().documentNumber.value).toContain('*')

    const reveal = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/reveal`,
      headers: { cookie: user },
    })
    expect(reveal.statusCode).toBe(200)
    expect(reveal.body).toContain('@dg 1')

    const again = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/reveal`,
      headers: { cookie: user },
    })
    expect(again.statusCode).toBe(410)

    // The public status route is a capability; the unmasked reviewer view is
    // not available to an unrelated maintainer.
    const other = await login(app, oidc, 'dsc', 'dsc-client', AS_REVIEWER)
    const forbidden = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}/review`,
      headers: { cookie: other },
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('exposes the unmasked submission to reviewers only', async () => {
    const { app, oidc } = await harness()
    const user = await login(app, oidc, 'dsc', 'dsc-client', USER)
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const created = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: user },
      payload: payload('R1000001'),
    })
    const reference = created.json().reference as string

    // Anonymous cannot read the reviewer view.
    const anon = await app.inject({ method: 'GET', url: `/dsc/requests/${reference}/review` })
    expect(anon.statusCode).toBe(401)

    // A NIA administrator sees the raw document number.
    const adminView = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}/review`,
      headers: { cookie: admin },
    })
    expect(adminView.statusCode).toBe(200)
    expect(adminView.json().payload.mrz.documentNumber).toBe('R1000001')

    // The status route stays masked (no unmasked payload field) but now
    // requires the owner to be signed in.
    const anonStatus = await app.inject({ method: 'GET', url: `/dsc/requests/${reference}` })
    expect(anonStatus.statusCode).toBe(401)
    const status = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}`,
      headers: { cookie: user },
    })
    expect(status.statusCode).toBe(200)
    expect(status.json().payload).toBeUndefined()
  })

  it('reports the DSC review scope in /me', async () => {
    const { app, oidc } = await harness()
    const user = await login(app, oidc, 'dsc', 'dsc-client', USER)
    const me = await app.inject({ method: 'GET', url: '/auth/dsc/me', headers: { cookie: user } })
    expect(me.json().reviewScope).toBe('none')

    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const adminMe = await app.inject({
      method: 'GET',
      url: '/auth/dsc/me',
      headers: { cookie: admin },
    })
    expect(adminMe.json().reviewScope).toBe('nia')
  })

  it('supersedes the previous active passport on re-issuance', async () => {
    const { app, oidc } = await harness()
    const admin = await login(app, oidc, 'dsc', 'dsc-client', NIA_DSC_ADMIN)
    const cookie = await applicant(app, oidc)

    // No active passport initially, and a pending application is not one yet.
    const initial = await app.inject({
      method: 'GET',
      url: '/dsc/passports/active',
      headers: { cookie },
    })
    expect(initial.statusCode).toBe(200)
    expect(initial.json().passport).toBeNull()

    const created = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('P1000001'),
    })
    const reference = created.json().reference as string
    const pending = await app.inject({
      method: 'GET',
      url: '/dsc/passports/active',
      headers: { cookie },
    })
    expect(pending.json().passport).toBeNull()

    await app.inject({
      method: 'POST',
      url: `/dsc/requests/${reference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })

    // The produced passport is now active and visible to its owner.
    const active = await app.inject({
      method: 'GET',
      url: '/dsc/passports/active',
      headers: { cookie },
    })
    expect(active.statusCode).toBe(200)
    expect(active.json().passport.reference).toBe(reference)
    expect(active.json().passport.documentNumber).toBe('P1000001')

    // An unrelated signed-in user may not look up the reference.
    const stranger = await applicant(app, oidc)
    const foreignLookup = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}`,
      headers: { cookie: stranger },
    })
    expect(foreignLookup.statusCode).toBe(403)

    // A second submission is allowed while a passport is active.
    const second = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie },
      payload: payload('P2000002'),
    })
    expect(second.statusCode).toBe(201)
    const secondReference = second.json().reference as string

    // Only the owner may revoke a passport.
    const forbidden = await app.inject({
      method: 'POST',
      url: `/dsc/passports/${reference}/revoke`,
      headers: { cookie: stranger },
      payload: {},
    })
    expect(forbidden.statusCode).toBe(403)

    // Approving the re-issued passport invalidates the previous active one.
    const approveSecond = await app.inject({
      method: 'POST',
      url: `/dsc/requests/${secondReference}/approve`,
      headers: { cookie: admin },
      payload: {},
    })
    expect(approveSecond.statusCode).toBe(200)

    const previous = await app.inject({
      method: 'GET',
      url: `/dsc/requests/${reference}`,
      headers: { cookie },
    })
    expect(previous.json().status).toBe('revoked')

    // The new passport is now the single active one.
    const active2 = await app.inject({
      method: 'GET',
      url: '/dsc/passports/active',
      headers: { cookie },
    })
    expect(active2.json().passport.reference).toBe(secondReference)

    // The owner may still revoke it explicitly.
    const revoke = await app.inject({
      method: 'POST',
      url: `/dsc/passports/${secondReference}/revoke`,
      headers: { cookie },
      payload: { reason: 'reissued' },
    })
    expect(revoke.statusCode).toBe(200)
    expect(revoke.json().status).toBe('revoked')
  })

  it('scopes "my requests" by account regardless of dn42 claims', async () => {
    const { app, oidc, db } = await harness()
    db.insert(mntConfig)
      .values({ mnt: 'AS1-REV-MNT', useNiaDsc: true, updatedAt: new Date().toISOString() })
      .run()
    recordAsAdmin(db, 'AS1-REV-MNT')

    const reviewerCookie = await login(app, oidc, 'dsc', 'dsc-client', AS_REVIEWER)
    const colleagueCookie = await login(app, oidc, 'dsc', 'dsc-client', {
      sub: 'as1-colleague',
      dn42: { asn: 4242420002, active_mnt: 'AS1-REV-MNT', mnt_by: ['AS1-REV-MNT'] },
    })

    const own = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
      payload: payload('M1111111', { dscSelection: { mode: 'nia' } }),
    })
    const ownId = own.json().reference as string
    const shared = await app.inject({
      method: 'POST',
      url: '/dsc/requests',
      headers: { cookie: colleagueCookie },
      payload: payload('M2222222', { dscSelection: { mode: 'nia' } }),
    })
    const sharedId = shared.json().reference as string

    // The review scope covers the whole maintainer...
    const scoped = await app.inject({
      method: 'GET',
      url: '/dsc/requests',
      headers: { cookie: reviewerCookie },
    })
    const scopedIds = (scoped.json().items as { reference: string }[]).map(
      (entry) => entry.reference,
    )
    expect(scopedIds).toContain(ownId)
    expect(scopedIds).toContain(sharedId)

    // ...but "my requests" is keyed by the account, independent of mnt/dn42.
    const mine = await app.inject({
      method: 'GET',
      url: '/dsc/requests?mine=1',
      headers: { cookie: reviewerCookie },
    })
    const mineIds = (mine.json().items as { reference: string }[]).map((entry) => entry.reference)
    expect(mineIds).toContain(ownId)
    expect(mineIds).not.toContain(sharedId)
  })
})
