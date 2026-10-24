/**
 * CSCA application scenarios: submission, listing, review and the LDS2 Signer
 * variant, including the authorization boundaries between applicants,
 * administrators and other maintainers.
 */
import { describe, expect, it } from 'vitest'

import { lds2SignerTypesFromOids, OIDS } from '@epass42/shared'
import {
  parseCertificatePem,
  pemToDer,
  validateCertProfile,
  verifyDscAgainstCsca,
} from '@epass42/pki'

import { CLIENT_IDS, CSCA_ADMIN, CSCA_USER, OTHER_USER } from '../../fixtures/identities'
import { ecCsrPem, ecPublicKeyPem, rsaPublicKeyPem } from '../../fixtures/keys'
import { loginAs, withBackend, type HttpClient } from '../harness'
import type { CertMetadata } from '../types'

/** Submits an application as the signed-in user. */
async function submitApplication(
  client: HttpClient,
  body: Record<string, unknown>,
): Promise<number> {
  const submit = await client.post('/csca/applications', body)
  expect(submit.status).toBe(201)
  return submit.json<{ id: number }>().id
}

/** Approves an application as the signed-in administrator. */
async function approveApplication(client: HttpClient, id: number): Promise<CertMetadata> {
  const approve = await client.post(`/csca/applications/${id}/approve`, {})
  expect(approve.status).toBe(201)
  return approve.json<CertMetadata>()
}

describe('backend e2e — CSCA applications', () => {
  it('submits, lists, pages and reviews DSC applications', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)

      const first = await submitApplication(backend.client, {
        keyMode: 'remote_generated',
        subjectCn: 'E2E HTTP DSC P',
        documentTypes: ['P'],
        notes: 'passport signer',
      })
      const second = await submitApplication(backend.client, {
        keyMode: 'remote_generated',
        subjectCn: 'E2E HTTP DSC ID',
        documentTypes: ['ID'],
      })

      const own = await backend.client.get('/csca/applications')
      const ownPage = own.json<{
        total: number
        scope: string
        items: { id: number; status: string; mnt: string | null }[]
      }>()
      expect(ownPage.total).toBe(2)
      expect(ownPage.scope).toBe('own')
      expect(ownPage.items.map((row) => row.id)).toEqual([second, first])

      const page = await backend.client.get('/csca/applications?limit=1&offset=1')
      expect(page.json<{ total: number; items: unknown[] }>().total).toBe(2)
      expect(page.json<{ items: unknown[] }>().items).toHaveLength(1)

      const detail = await backend.client.get(`/csca/applications/${first}`)
      expect(detail.status).toBe(200)
      const detailBody = detail.json<{
        id: number
        status: string
        subjectCn: string
        mnt: string
        hasPrivateKey: boolean
      }>()
      expect(detailBody.status).toBe('submitted')
      expect(detailBody.subjectCn).toBe('E2E HTTP DSC P')
      expect(detailBody.mnt).toBe('USER-MNT')
      expect(detailBody.hasPrivateKey).toBe(false)

      // Only an administrator may review; a different maintainer cannot see it.
      expect((await backend.client.post(`/csca/applications/${first}/approve`, {})).status).toBe(
        403,
      )
      await loginAs(backend, 'csca', CLIENT_IDS.csca, OTHER_USER)
      expect((await backend.client.get(`/csca/applications/${first}`)).status).toBe(403)
      expect((await backend.client.get('/csca/applications')).json<{ total: number }>().total).toBe(
        0,
      )

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const all = await backend.client.get('/csca/applications')
      expect(all.json<{ total: number; scope: string }>().scope).toBe('all')
      expect(all.json<{ total: number }>().total).toBe(2)

      const approved = await approveApplication(backend.client, first)
      expect(approved.certificateType).toBe('dsc')
      expect(approved.documentTypes).toEqual(['P'])
      expect(approved.documentType).toBe('P')
      expect(approved.lds2Types).toEqual([])
      expect(approved.source).toBe('owned')
      expect(approved.mnt).toBe('USER-MNT')
      expect(approved.status).toBe('active')
      expect(approved.hasPrivateKey).toBe(true)
      expect(approved.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/)

      const rejected = await backend.client.post(`/csca/applications/${second}/reject`, {
        reason: 'document type not supported yet',
      })
      expect(rejected.status).toBe(200)
      expect(rejected.json<{ status: string }>().status).toBe('rejected')

      const approvedList = await backend.client.get('/csca/applications?status=approved')
      expect(approvedList.json<{ total: number }>().total).toBe(1)

      const approvedDetail = await backend.client.get(`/csca/applications/${first}`)
      expect(approvedDetail.json<{ status: string }>().status).toBe('approved')
      expect(approvedDetail.json<{ hasPrivateKey: boolean }>().hasPrivateKey).toBe(true)

      const rejectedDetail = await backend.client.get(`/csca/applications/${second}`)
      expect(rejectedDetail.json<{ status: string }>().status).toBe('rejected')
      expect(rejectedDetail.json<{ rejectReason: string }>().rejectReason).toBe(
        'document type not supported yet',
      )

      // A reviewed application cannot be reviewed a second time.
      expect((await backend.client.post(`/csca/applications/${first}/approve`, {})).status).toBe(
        409,
      )
      expect(
        (await backend.client.post(`/csca/applications/${second}/reject`, { reason: 'again' }))
          .status,
      ).toBe(409)
    })
  })

  it('validates the subject, document types and uploaded keys', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)

      // Missing CSR/SPKI for an uploaded key.
      const missingKey = await backend.client.post('/csca/applications', {
        keyMode: 'user_uploaded',
        subjectCn: 'No Key',
        documentTypes: ['P'],
      })
      expect(missingKey.status).toBe(400)
      expect(missingKey.json<{ error: string }>().error).toBe('csr_or_public_key_required')

      // Invalid subject-name characters and an empty document type list.
      const badSubject = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'bad,name',
        documentTypes: ['P'],
      })
      expect(badSubject.status).toBe(400)
      expect(badSubject.json<{ error: string }>().error).toBe('validation_failed')

      const noType = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'No Type',
        documentTypes: [],
      })
      expect(noType.status).toBe(400)

      // A user-uploaded SubjectPublicKeyInfo is certified as-is.
      const publicKeyPem = await ecPublicKeyPem()
      const uploadedId = await submitApplication(backend.client, {
        keyMode: 'user_uploaded',
        subjectCn: 'Uploaded Key DSC',
        publicKeyPem,
        documentTypes: ['P', 'ID'],
      })

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const uploaded = await approveApplication(backend.client, uploadedId)
      expect(uploaded.keyMode).toBe('user_uploaded')
      expect(uploaded.hasPrivateKey).toBe(false)
      expect(uploaded.documentTypes).toEqual(['P', 'ID'])
      const certificate = parseCertificatePem(uploaded.certPem)
      expect(new Uint8Array(certificate.publicKey.rawData)).toEqual(pemToDer(publicKeyPem))
      expect(validateCertProfile(certificate, 'dsc').valid).toBe(true)
      expect(
        (await verifyDscAgainstCsca(certificate, [parseCertificatePem(backend.cscaPem())])).valid,
      ).toBe(true)

      // The CSR path extracts the same SubjectPublicKeyInfo.
      const csr = await ecCsrPem('CSR DSC')
      const csrId = await submitApplication(backend.client, {
        keyMode: 'user_uploaded',
        subjectCn: 'CSR DSC',
        csrPem: csr.csrPem,
        documentTypes: ['P'],
      })
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const csrCertificate = await approveApplication(backend.client, csrId)
      expect(new Uint8Array(parseCertificatePem(csrCertificate.certPem).publicKey.rawData)).toEqual(
        csr.publicKeyDer,
      )
    })
  })

  it('issues an LDS2 Signer certificate with its ExtendedKeyUsage roles', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)

      // LDS2 Signer validation rules: at least one role, no duplicates, CN ≤ 9.
      for (const body of [
        { certificateType: 'lds2', subjectCn: 'LDS2', lds2Types: [] },
        { certificateType: 'lds2', subjectCn: 'LDS2', lds2Types: ['ts', 'ts'] },
        { certificateType: 'lds2', subjectCn: 'TOOLONGNAME', lds2Types: ['ts'] },
      ]) {
        const invalid = await backend.client.post('/csca/applications', {
          keyMode: 'remote_generated',
          ...body,
        })
        expect(invalid.status).toBe(400)
        expect(invalid.json<{ error: string }>().error).toBe('validation_failed')
      }

      // The role list is deduplicated before storage.
      const id = await submitApplication(backend.client, {
        keyMode: 'remote_generated',
        certificateType: 'lds2',
        subjectCn: 'LDS2TS',
        lds2Types: ['ts', 'v'],
        validityDays: 3760,
      })

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const lds2 = await approveApplication(backend.client, id)
      expect(lds2.certificateType).toBe('lds2')
      expect(lds2.lds2Types).toEqual(['ts', 'v'])
      expect(lds2.documentTypes).toEqual([])
      expect(lds2.hasPrivateKey).toBe(true)

      const certificate = parseCertificatePem(lds2.certPem)
      expect(validateCertProfile(certificate, 'lds2-signer').errors).toEqual([])
      expect(
        (
          await verifyDscAgainstCsca(
            certificate,
            [parseCertificatePem(backend.cscaPem())],
            'lds2-signer',
          )
        ).valid,
      ).toBe(true)
      const eku = certificate.getExtension(OIDS.extKeyUsage) as { usages?: string[] } | undefined
      expect(lds2SignerTypesFromOids(eku?.usages ?? [])).toEqual(['ts', 'v'])
      // No DocumentType extension and no DSC-only KeyUsage on an LDS2 Signer.
      expect(certificate.getExtension(OIDS.idIcaoDocumentType)).toBeFalsy()
      expect(certificate.getExtension(OIDS.keyUsage)).toBeFalsy()

      // An uploaded RSA key violates the mandatory ECDSA subject key.
      const rsaId = await submitApplication(backend.client, {
        keyMode: 'user_uploaded',
        certificateType: 'lds2',
        subjectCn: 'LDS2RSA',
        lds2Types: ['ts'],
        publicKeyPem: await rsaPublicKeyPem(),
      })
      const badKey = await backend.client.post(`/csca/applications/${rsaId}/approve`, {})
      expect(badKey.status).toBe(400)
      expect(badKey.json<{ error: string }>().error).toBe('bad_request')
    })
  })

  it('requires an authenticated applicant to submit a signer application', async () => {
    await withBackend(async (backend) => {
      const anonymous = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Anonymous',
        documentTypes: ['P'],
      })
      expect(anonymous.status).toBe(401)

      // An application id that does not exist is a 404 for authenticated users.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect((await backend.client.get('/csca/applications/9999')).status).toBe(404)
      expect((await backend.client.post('/csca/applications/9999/approve', {})).status).toBe(404)
      expect(
        (await backend.client.post('/csca/applications/9999/reject', { reason: 'x' })).status,
      ).toBe(404)
    })
  })

  it('honours the requested validity at the ten-year DSC limit', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      const id = await submitApplication(backend.client, {
        keyMode: 'remote_generated',
        subjectCn: 'Range DSC',
        documentTypes: ['P'],
        validityDays: 3650,
      })
      const tooLong = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Too Long DSC',
        documentTypes: ['P'],
        validityDays: 3651,
      })
      expect(tooLong.status).toBe(400)
      expect(tooLong.json<{ error: string }>().error).toBe('validation_failed')

      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const cert = await approveApplication(backend.client, id)
      const years = (Date.parse(cert.notAfter) - Date.parse(cert.notBefore)) / (365.25 * 86_400_000)
      expect(years).toBeGreaterThan(10)
      expect(years).toBeLessThan(11)
    })
  })
})
