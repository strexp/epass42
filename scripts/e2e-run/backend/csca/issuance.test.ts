/**
 * CSCA certificate scenarios: PEM/DER download, one-time private-key export,
 * revocation and CRLs, key rollover with per-issuer CRLs, the NIA DSC
 * lifecycle and maintainer delegation.
 */
import { describe, expect, it } from 'vitest'

import {
  crlFingerprint,
  derToPem,
  isRevoked,
  parseCertificatePem,
  parseCrl,
  parseCrlPem,
  readCrlNumber,
} from '@epass42/pki'

import {
  CLIENT_IDS,
  CSCA_ADMIN,
  CSCA_USER,
  DSC_ADMIN,
  ML_ADMIN,
  OTHER_USER,
} from '../../fixtures/identities'
import { publicKeyDerOfPrivateKey } from '../../fixtures/keys'
import { expireDsc } from '../actions'
import { loginAs, withBackend, type Backend } from '../harness'
import type { CertMetadata } from '../types'

/** Submits and approves one remote-generated DSC as the given identities. */
async function issueDsc(
  backend: Backend,
  subjectCn: string,
  documentTypes: string[] = ['P'],
): Promise<CertMetadata> {
  await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
  const submit = await backend.client.post('/csca/applications', {
    keyMode: 'remote_generated',
    subjectCn,
    documentTypes,
  })
  expect(submit.status).toBe(201)
  const id = submit.json<{ id: number }>().id
  await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
  const approve = await backend.client.post(`/csca/applications/${id}/approve`, {})
  expect(approve.status).toBe(201)
  return approve.json<CertMetadata>()
}

/** Finds the certificate metadata of the active NIA DSC. */
async function niaDscMetadata(backend: Backend) {
  const response = await backend.client.get('/csca/certificates')
  expect(response.status).toBe(200)
  return response.json<{ items: CertMetadata[] }>().items.find((item) => item.source === 'nia')
}

describe('backend e2e — CSCA certificate lifecycle', () => {
  it('downloads certificates and exports the private key exactly once', async () => {
    await withBackend(async (backend) => {
      const issued = await issueDsc(backend, 'Downloadable DSC')
      const der = derOf(issued.certPem)

      // Certificate downloads are public and encoding-equivalent.
      const pem = await backend.client.get(`/csca/certificates/${issued.id}.pem`)
      expect(pem.status).toBe(200)
      expect(pem.headers.get('content-type')).toContain('application/x-pem-file')
      expect(pem.text).toBe(issued.certPem)

      const binary = await backend.client.get(`/csca/certificates/${issued.id}.der`)
      expect(binary.status).toBe(200)
      expect(binary.headers.get('content-type')).toContain('application/pkix-cert')
      expect(binary.bytes).toEqual(der)

      const list = await backend.client.get('/csca/certificates')
      expect(list.json<{ items: CertMetadata[] }>().items.map((item) => item.id)).toContain(
        issued.id,
      )
      expect((await backend.client.get('/csca/certificates/9999.pem')).status).toBe(404)
      expect((await backend.client.get('/csca/certificates/9999.der')).status).toBe(404)

      // A different maintainer may not take the key.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, OTHER_USER)
      expect((await backend.client.get(`/csca/certificates/${issued.id}/private-key`)).status).toBe(
        403,
      )

      // The owner exports it once; the response is uncacheable.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const key = await backend.client.get(`/csca/certificates/${issued.id}/private-key`)
      expect(key.status).toBe(200)
      expect(key.headers.get('cache-control')).toBe('no-store')
      expect(key.headers.get('content-disposition')).toContain(`dsc-${issued.id}.key`)
      expect(key.text).toContain('BEGIN PRIVATE KEY')
      expect(publicKeyDerOfPrivateKey(key.text)).toEqual(
        new Uint8Array(parseCertificatePem(issued.certPem).publicKey.rawData),
      )

      const again = await backend.client.get(`/csca/certificates/${issued.id}/private-key`)
      expect(again.status).toBe(410)
      expect(again.json<{ error: string }>().error).toBe('private_key_consumed')

      // An administrator may export a maintainer's key instead.
      const second = await issueDsc(backend, 'Admin Export DSC')
      expect((await backend.client.get(`/csca/certificates/${second.id}/private-key`)).status).toBe(
        200,
      )
    })
  })

  it('revokes certificates and publishes signed CRLs', async () => {
    await withBackend(async (backend) => {
      const first = await issueDsc(backend, 'Revoked DSC')
      const second = await issueDsc(backend, 'Kept DSC')

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const revoke = await backend.client.post(`/csca/certificates/${first.id}/revoke`, {
        reason: 'key compromise',
      })
      expect(revoke.status).toBe(200)
      const revoked = revoke.json<CertMetadata>()
      expect(revoked.status).toBe('revoked')
      expect(revoked.revokedAt).not.toBeNull()

      // The owning maintainer cannot revoke another maintainer's certificate.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, OTHER_USER)
      expect(
        (await backend.client.post(`/csca/certificates/${second.id}/revoke`, { reason: 'nope' }))
          .status,
      ).toBe(403)

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect((await backend.client.post(`/csca/certificates/${first.id}/revoke`, {})).status).toBe(
        409,
      )
      expect(
        (await backend.client.post(`/csca/certificates/${second.id}/revoke`, { reason: 'retired' }))
          .status,
      ).toBe(200)

      // System-managed signers are never revoked through the registry.
      const nia = await niaDscMetadata(backend)
      expect(nia).toBeDefined()
      expect((await backend.client.post(`/csca/certificates/${nia!.id}/revoke`, {})).status).toBe(
        403,
      )

      const crlResponse = await backend.client.get('/csca/crl.der')
      expect(crlResponse.status).toBe(200)
      expect(crlResponse.headers.get('content-type')).toContain('application/pkix-crl')
      const crl = parseCrl(crlResponse.bytes)
      const csca = parseCertificatePem(backend.cscaPem())
      expect(await crl.verify({ publicKey: csca.publicKey })).toBe(true)
      expect(readCrlNumber(crl)).toBeGreaterThanOrEqual(1n)
      expect(crlFingerprint(crl)).toMatch(/^[0-9a-f]{64}$/i)
      expect(isRevoked(crl, first.serial)).not.toBeNull()
      expect(isRevoked(crl, second.serial)).not.toBeNull()

      // Manual generation advances the CRL number; only administrators may do it.
      const generated = await backend.client.post('/csca/crl/generate', {})
      expect(generated.status).toBe(201)
      const generatedNumber = generated.json<{ crlNumber: number }>().crlNumber
      expect(BigInt(generatedNumber)).toBeGreaterThan(readCrlNumber(crl)!)
      expect(readCrlNumber(parseCrl((await backend.client.get('/csca/crl.der')).bytes))).toBe(
        BigInt(generatedNumber),
      )
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect((await backend.client.post('/csca/crl/generate', {})).status).toBe(403)

      const pemCrl = await backend.client.get('/csca/crl.pem')
      expect(pemCrl.status).toBe(200)
      expect(pemCrl.text).toContain('BEGIN X509 CRL')
      expect(readCrlNumber(parseCrlPem(pemCrl.text))).toBe(BigInt(generatedNumber))

      // The CRL is also a published PKD object with its issuer metadata.
      // The public registry hides revoked certificates unless asked.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const activeCertificates = (await backend.client.get('/csca/certificates')).json<{
        items: CertMetadata[]
      }>()
      expect(activeCertificates.items.map((item) => item.id)).not.toContain(first.id)
      expect(activeCertificates.items.map((item) => item.id)).not.toContain(second.id)
      const allCertificates = (
        await backend.client.get('/csca/certificates?includeRevoked=true')
      ).json<{ items: CertMetadata[] }>()
      expect(allCertificates.items.map((item) => item.id)).toEqual(
        expect.arrayContaining([first.id, second.id]),
      )

      const published = await backend.client.get('/pkd/crls')
      const row = published
        .json<{
          items: {
            id: string
            crlNumber: number
            cscaKeyId: number
            cscaSerial: string
            cscaSubject: string
            thisUpdate: string
            nextUpdate: string
          }[]
        }>()
        .items.find((item) => item.crlNumber === Number(readCrlNumber(crl)))
      expect(row).toBeDefined()
      expect(row?.cscaSerial).toBe(csca.serialNumber)
      expect(row?.cscaSubject).toBe(csca.subject)
      expect(Date.parse(row!.nextUpdate)).toBeGreaterThan(Date.parse(row!.thisUpdate))
      const object = await backend.client.get(`/pkd/objects/${row!.id}.der`)
      expect(object.status).toBe(200)
      expect(object.bytes).toEqual(crlResponse.bytes)
    })
  })

  it('rolls the CSCA key over and keeps a CRL per issuing key', async () => {
    await withBackend(async (backend) => {
      const oldCert = await issueDsc(backend, 'Old Key DSC')
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect(
        (await backend.client.post(`/csca/certificates/${oldCert.id}/revoke`, { reason: 'old' }))
          .status,
      ).toBe(200)

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect((await backend.client.post('/csca/keys/rollover', { confirm: true })).status).toBe(403)

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect((await backend.client.post('/csca/keys/rollover', { confirm: false })).status).toBe(
        400,
      )
      const rollover = await backend.client.post('/csca/keys/rollover', { confirm: true })
      expect(rollover.status).toBe(200)
      const { previous, current } = rollover.json<{ previous: number; current: number }>()
      expect(current).not.toBe(previous)

      const newCert = await issueDsc(backend, 'New Key DSC')
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect(
        (await backend.client.post(`/csca/certificates/${newCert.id}/revoke`, { reason: 'new' }))
          .status,
      ).toBe(200)

      const status = await backend.client.get('/csca/status')
      expect(status.json<{ csca: { id: number } }>().csca.id).toBe(current)
      expect(status.json<{ canIssueCertificates: boolean }>().canIssueCertificates).toBe(true)

      // The current key's CRL covers only the current key's revocations.
      const currentDer = await backend.client.get(`/pkd/objects/csca-${current}.der`)
      const currentCrl = parseCrl((await backend.client.get('/csca/crl.der')).bytes)
      expect(
        await currentCrl.verify({
          publicKey: parseCertificatePem(pemOf(currentDer.bytes)).publicKey,
        }),
      ).toBe(true)
      expect(isRevoked(currentCrl, newCert.serial)).not.toBeNull()
      expect(isRevoked(currentCrl, oldCert.serial)).toBeNull()

      // The previous key still publishes the old revocation under its own CRL.
      const crls = (await backend.client.get('/pkd/crls')).json<{
        items: { id: string; crlNumber: number; cscaKeyId: number }[]
      }>().items
      const oldRow = crls
        .filter((row) => row.cscaKeyId === previous)
        .sort((a, b) => b.crlNumber - a.crlNumber)[0]
      expect(oldRow).toBeDefined()
      const oldCrl = parseCrl((await backend.client.get(`/pkd/objects/${oldRow!.id}.der`)).bytes)
      const oldKeyDer = await backend.client.get(`/pkd/objects/csca-${previous}.der`)
      expect(
        await oldCrl.verify({ publicKey: parseCertificatePem(pemOf(oldKeyDer.bytes)).publicKey }),
      ).toBe(true)
      expect(isRevoked(oldCrl, oldCert.serial)).not.toBeNull()
      expect(isRevoked(oldCrl, newCert.serial)).toBeNull()
      expect(oldRow!.crlNumber).toBeLessThan(Number(readCrlNumber(currentCrl)))

      // Both CSCA certificates (root + link + successor) are published.
      const certificates = (await backend.client.get('/pkd/certificates')).json<{
        total: number
        items: { id: string; cscaKeyId: number; status: string }[]
      }>()
      expect(certificates.total).toBe(3)
      expect(certificates.items.map((item) => item.cscaKeyId)).toEqual(
        expect.arrayContaining([previous, current]),
      )
      expect(certificates.items.map((item) => item.status)).toEqual(
        expect.arrayContaining(['retired', 'link', 'active']),
      )
    })
  })

  it('maintains the NIA Document Signer lifecycle', async () => {
    await withBackend(async (backend) => {
      const initialStatus = await backend.client.get('/csca/status')
      expect(initialStatus.json<{ csca: { status: string } }>().csca.status).toBe('active')
      expect(initialStatus.json<{ canIssueCertificates: boolean }>().canIssueCertificates).toBe(
        true,
      )

      const initialDsc = await backend.client.get('/dsc/status')
      expect(initialDsc.json<{ canIssueDocuments: boolean }>().canIssueDocuments).toBe(true)
      const firstId = initialDsc.json<{ niaDsc: { id: number } }>().niaDsc.id
      expect(
        initialDsc.json<{
          niaDsc: {
            notBefore: string | null
            notAfter: string | null
            privateKeyNotAfter: string | null
            effectiveNotAfter: string | null
          }
        }>().niaDsc,
      ).toMatchObject({
        notBefore: expect.any(String),
        notAfter: expect.any(String),
        privateKeyNotAfter: expect.any(String),
        effectiveNotAfter: expect.any(String),
      })

      // A csca administrator is not a dsc administrator.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect((await backend.client.post('/dsc/nia-dsc/rotate', { confirm: true })).status).toBe(401)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const rotated = await backend.client.post('/dsc/nia-dsc/rotate', { confirm: true })
      expect(rotated.status).toBe(200)
      const ids = rotated.json<{ previous: number | null; current: number }>()
      expect(ids.previous).toBe(firstId)
      expect(ids.current).not.toBe(firstId)

      const after = await backend.client.get('/dsc/status')
      expect(after.json<{ niaDsc: { id: number; status: string } }>().niaDsc).toMatchObject({
        id: ids.current,
        status: 'active',
      })
      expect(after.json<{ canIssueDocuments: boolean }>().canIssueDocuments).toBe(true)

      // The retired signer stays published, but is never selected again.
      const published = (await backend.client.get('/pkd/dscs')).json<{
        items: { id: number; source: string; status: string }[]
      }>()
      expect(published.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: firstId, source: 'nia', status: 'retired' }),
          expect.objectContaining({ id: ids.current, source: 'nia', status: 'active' }),
        ]),
      )
      expect(
        (await backend.client.get('/csca/certificates?includeRevoked=true')).json<{
          items: { id: number; status: string }[]
        }>().items,
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: firstId, status: 'retired' })]),
      )
    })
  })

  it('delegates DSC issuance to a maintainer-owned certificate', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const initial = await backend.client.get('/csca/settings/mnt')
      expect(initial.status).toBe(200)
      expect(initial.json<{ mnt: string; useNiaDsc: boolean; hasActiveDsc: boolean }>()).toEqual({
        mnt: 'USER-MNT',
        useNiaDsc: true,
        hasActiveDsc: false,
      })

      const missing = await backend.client.put('/csca/settings/mnt', { useNiaDsc: false })
      expect(missing.status).toBe(409)
      expect(missing.json<{ error: string }>().error).toBe('no_active_dsc')

      const issued = await issueDsc(backend, 'Owned DSC', ['P'])
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const delegated = await backend.client.put('/csca/settings/mnt', { useNiaDsc: false })
      expect(delegated.status).toBe(200)
      expect(delegated.json<{ useNiaDsc: boolean; hasActiveDsc: boolean }>()).toMatchObject({
        useNiaDsc: false,
        hasActiveDsc: true,
      })
      expect(issued.certificateType).toBe('dsc')

      // The dsc realm sees the same maintainer delegation.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, CSCA_USER)
      const dscView = await backend.client.get('/dsc/settings/mnt')
      expect(dscView.json<{ useNiaDsc: boolean; hasActiveDsc: boolean }>()).toMatchObject({
        useNiaDsc: false,
        hasActiveDsc: true,
      })
      const restored = await backend.client.put('/dsc/settings/mnt', { useNiaDsc: true })
      expect(restored.status).toBe(200)
      expect(restored.json<{ useNiaDsc: boolean }>().useNiaDsc).toBe(true)

      // An expired owned DSC is no longer offered as a delegation target.
      expireDsc(backend, issued.id)
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const expired = await backend.client.get('/csca/settings/mnt')
      expect(expired.json<{ hasActiveDsc: boolean }>().hasActiveDsc).toBe(false)
      const cannotOptOut = await backend.client.put('/csca/settings/mnt', { useNiaDsc: false })
      expect(cannotOptOut.status).toBe(409)
      expect(cannotOptOut.json<{ error: string }>().error).toBe('no_active_dsc')
    })
  })

  it('blocks issuance while the CSCA certificate is expired', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const pending = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Pending DSC',
        documentTypes: ['P'],
      })
      expect(pending.status).toBe(201)
      const pendingId = pending.json<{ id: number }>().id

      expire(backend, 'csca_key', 'WHERE is_current = 1')

      const status = await backend.client.get('/csca/status')
      expect(status.json<{ canIssueCertificates: boolean }>().canIssueCertificates).toBe(false)
      expect(status.json<{ csca: { expired: boolean } }>().csca.expired).toBe(true)

      const submit = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Too Late',
        documentTypes: ['P'],
      })
      expect(submit.status).toBe(409)
      expect(submit.json<{ error: string }>().error).toBe('csca_expired')

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const approve = await backend.client.post(`/csca/applications/${pendingId}/approve`, {})
      expect(approve.status).toBe(409)
      expect(approve.json<{ error: string }>().error).toBe('csca_expired')

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const rotate = await backend.client.post('/dsc/nia-dsc/rotate', { confirm: true })
      expect(rotate.status).toBe(409)
      expect(rotate.json<{ error: string }>().error).toBe('csca_expired')

      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const mlRotate = await backend.client.post('/ml/signers/rotate', { confirm: true })
      expect(mlRotate.status).toBe(409)
      expect(mlRotate.json<{ error: string }>().error).toBe('csca_expired')

      // Published artefacts remain readable during the outage.
      expect((await backend.client.get('/pkd/certificates')).status).toBe(200)
      expect((await backend.client.get('/csca/certificates')).status).toBe(200)
    })
  })

  it('requires an owner or administrator to revoke a certificate', async () => {
    await withBackend(async (backend) => {
      const issued = await issueDsc(backend, 'Tenant DSC')
      await loginAs(backend, 'csca', CLIENT_IDS.csca, OTHER_USER)
      expect((await backend.client.post(`/csca/certificates/${issued.id}/revoke`, {})).status).toBe(
        403,
      )
      expect((await backend.client.get(`/csca/certificates/${issued.id}/private-key`)).status).toBe(
        403,
      )
      expect((await backend.client.post('/csca/certificates/9999/revoke', {})).status).toBe(404)
    })
  })

  it('publishes a CRL manually and records the action in the audit log', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect((await backend.client.post('/csca/crl/generate', {})).status).toBe(403)

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const first = await backend.client.post('/csca/crl/generate', {})
      expect(first.status).toBe(201)
      const firstNumber = first.json<{ crlNumber: number }>().crlNumber

      const second = await backend.client.post('/csca/crl/generate', {})
      expect(second.status).toBe(201)
      const secondNumber = second.json<{ crlNumber: number }>().crlNumber
      expect(secondNumber).toBeGreaterThan(firstNumber)

      // The newest CRL is served by the download endpoint and published in PKD.
      const der = await backend.client.get('/csca/crl.der')
      expect(der.status).toBe(200)
      expect(readCrlNumber(parseCrl(der.bytes))).toBe(BigInt(secondNumber))

      const published = (await backend.client.get('/pkd/crls'))
        .json<{
          items: {
            crlNumber: number
            cscaStatus?: string
            cscaFingerprintSha256?: string
          }[]
        }>()
        .items.find((row) => row.crlNumber === secondNumber)
      expect(published).toMatchObject({ cscaStatus: 'active' })
      expect(published?.cscaFingerprintSha256).toMatch(/^[0-9a-f]{64}$/)

      // Manual publication is audited like every other administrative action.
      const audit = await backend.client.get('/csca/audit?action=crl.generate')
      expect(audit.status).toBe(200)
      expect(
        audit.json<{ items: { action: string; targetType: string | null }[] }>().items,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'crl.generate', targetType: 'crl' }),
        ]),
      )
    })
  })
})

/** Moves a certificate row's `not_after` into the past. */
function expire(backend: Backend, table: string, where: string): void {
  if (table === 'csca_key') {
    backend.sql(`UPDATE csca_key SET not_after = ? ${where}`, '2000-01-01T00:00:00.000Z')
    return
  }
  throw new Error(`unsupported table ${table}`)
}

/** The DER of a PEM certificate. */
function derOf(pem: string): Uint8Array {
  return new Uint8Array(parseCertificatePem(pem).rawData)
}

/** Converts certificate DER bytes to PEM. */
function pemOf(der: Uint8Array): string {
  return derToPem(der, 'CERTIFICATE')
}
