/**
 * DSC request intake scenarios: authentication, schema validation, masked
 * preview, listing/paging, jurisdiction resolution, owned-DSC delegation and
 * the NIA lifecycle gate.
 */
import { describe, expect, it } from 'vitest'

import {
  CLIENT_IDS,
  DSC_ADMIN,
  DSC_USER,
  OTHER_USER,
  USER_COLLEAGUE,
} from '../../fixtures/identities'
import { MRZ, richSignRequest, signRequest, td1SignRequest } from '../../fixtures/documents'
import { approveRequest, expireNiaDsc, issueCscaSigner, submitRequest } from '../actions'
import { loginAs, staticMntResolver, withBackend } from '../harness'

import type { RequestMetadata } from '../types'

interface Preview {
  documentNumber: { present: boolean; value?: string }
  surname: { present: boolean; value?: string }
  dateOfBirth: { present: boolean; value?: string }
  dateOfExpiry: { present: boolean; value?: string }
  can: { present: boolean; value?: string }
  dataGroups: number[]
  images: { dg2: boolean; dg5: boolean; dg7: boolean }
  biometrics: { dg3: boolean; dg4: boolean }
  additional: { dg11: boolean; dg12: boolean; dg13: boolean; dg16: boolean }
}

describe('backend e2e — DSC requests', () => {
  it('requires an authenticated applicant and validates the request', async () => {
    await withBackend(async (backend) => {
      const anonymous = await backend.client.post('/dsc/requests', signRequest())
      expect(anonymous.status).toBe(401)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const invalidSex = await backend.client.post(
        '/dsc/requests',
        signRequest(MRZ.documentNumber, { mrz: { ...MRZ, sex: 'X' } }),
      )
      expect(invalidSex.status).toBe(400)
      expect(invalidSex.json<{ error: string }>().error).toBe('validation_failed')

      const emptyNumber = await backend.client.post(
        '/dsc/requests',
        signRequest('', { mrz: { ...MRZ, documentNumber: '' } }),
      )
      expect(emptyNumber.status).toBe(400)

      const submitted = await backend.client.post('/dsc/requests', signRequest())
      expect(submitted.status).toBe(201)
      const body = submitted.json<{ reference: string; status: string }>()
      expect(body.status).toBe('submitted')
      expect(body.reference.length).toBeGreaterThan(16)

      // The reference lookup is not public.
      const anonymousClient = backend.createClient()
      expect((await anonymousClient.get(`/dsc/requests/${body.reference}`)).status).toBe(401)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, OTHER_USER)
      expect((await backend.client.get(`/dsc/requests/${body.reference}`)).status).toBe(403)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const status = await backend.client.get(`/dsc/requests/${body.reference}`)
      expect(status.status).toBe(200)
      const metadata = status.json<RequestMetadata>()
      expect(metadata.status).toBe('submitted')
      expect(metadata.dscSelection).toBe('nia')
      expect(metadata.mnt).toBe('USER-MNT')
      expect(metadata.dataGroups).toEqual([1, 2, 12])
      expect(metadata).not.toHaveProperty('payload')

      const list = await backend.client.get('/dsc/requests?mine=1')
      expect(list.json<{ items: RequestMetadata[] }>().items).toHaveLength(1)
      expect(list.json<{ items: RequestMetadata[] }>().items[0]?.reference).toBe(body.reference)
      expect((await backend.client.get('/dsc/requests/unknown-referenc')).status).toBe(404)
    })
  })

  it('serves a non-destructive masked preview with every data group', async () => {
    await withBackend(async (backend) => {
      const reference = await submitRequest(backend, richSignRequest())

      const preview = await backend.client.get(`/dsc/requests/${reference}/preview`)
      expect(preview.status).toBe(200)
      const masked = preview.json<Preview>()

      expect(masked.documentNumber.present).toBe(true)
      expect(masked.documentNumber.value).toBe('L8*****C<')
      expect(masked.documentNumber.value).not.toBe(MRZ.documentNumber)
      expect(masked.surname.value).toBe('ER****ON')
      expect(masked.dateOfBirth.value).toBe('69****')
      expect(masked.dateOfExpiry.value).toMatch(/^\d{2}\*{4}$/)
      expect(masked.dateOfExpiry.value).not.toBe(MRZ.dateOfExpiry)
      expect(masked.can.value).toBe('12**56')
      expect(masked.dataGroups).toEqual([1, 2, 3, 4, 5, 7, 11, 12, 13, 14, 15, 16])
      expect(masked.images).toEqual({ dg2: true, dg5: true, dg7: true })
      expect(masked.biometrics).toEqual({ dg3: true, dg4: true })
      expect(masked.additional).toEqual({ dg11: true, dg12: true, dg13: true, dg16: true })

      // The preview is read-only: the request is still unconsumed and pending.
      const status = await backend.client.get(`/dsc/requests/${reference}`)
      expect(status.json<RequestMetadata>().status).toBe('submitted')

      // A colleague in another maintainer cannot read it.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, OTHER_USER)
      expect((await backend.client.get(`/dsc/requests/${reference}/preview`)).status).toBe(403)
    })
  })

  it('rejects a face above the configured DG2 limit', async () => {
    await withBackend(
      async (backend) => {
        await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
        const response = await backend.client.post('/dsc/requests', signRequest())
        expect(response.status).toBe(413)
        expect(response.json<{ error: string }>().error).toBe('dg2_too_large')
      },
      { issuing: { dg2MaxBytes: 1024 } },
    )
  })

  it('resolves jurisdiction from the session and the client IP', async () => {
    await withBackend(
      async (backend) => {
        const anonymous = await backend.client.get('/dsc/jurisdiction')
        expect(anonymous.status).toBe(200)
        expect(anonymous.json()).toMatchObject({
          mnts: ['USER-MNT'],
          useNiaDsc: true,
          notice: false,
          reviewers: ['EXAMPLE-DSC-MNT'],
        })

        await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
        const signedIn = await backend.client.get('/dsc/jurisdiction')
        expect(signedIn.json<{ mnts: string[]; reviewers: string[] }>()).toMatchObject({
          mnts: ['USER-MNT'],
          reviewers: expect.arrayContaining(['USER-MNT', 'EXAMPLE-DSC-MNT']),
        })

        // A maintainer that opts out of the NIA DSC gets the notice, and its
        // published application URL is surfaced.
        const url = 'https://user.example.net/dsc'
        const owned = await issueCscaSigner(backend, {
          subjectCn: 'Owned DSC',
          documentTypes: ['P', 'ID'],
          applicationUrl: url,
        })
        expect(owned.applicationUrl).toBe(url)

        await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
        expect((await backend.client.put('/dsc/settings/mnt', { useNiaDsc: false })).status).toBe(
          200,
        )
        const optedOut = await backend.client.get('/dsc/jurisdiction')
        expect(optedOut.json()).toMatchObject({
          mnts: ['USER-MNT'],
          useNiaDsc: false,
          notice: true,
          ownDscUrl: url,
        })
      },
      {},
      { mntResolver: staticMntResolver({ '127.0.0.1': ['USER-MNT'] }) },
    )
  })

  it('selects the maintainer-owned DSC after delegation', async () => {
    await withBackend(async (backend) => {
      const owned = await issueCscaSigner(backend, {
        subjectCn: 'Delegated DSC',
        documentTypes: ['P', 'ID'],
      })
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect((await backend.client.put('/dsc/settings/mnt', { useNiaDsc: false })).status).toBe(200)

      const reference = await submitRequest(backend, signRequest())
      const metadata = (
        await backend.client.get(`/dsc/requests/${reference}`)
      ).json<RequestMetadata>()
      expect(metadata.dscSelection).toBe('owned')

      // The applicant is not a reviewer: only the NIA admin can approve.
      expect((await backend.client.post(`/dsc/requests/${reference}/approve`, {})).status).toBe(403)
      const approved = await approveRequest(backend, reference)
      expect(approved.status).toBe('approved')
      expect(owned.documentTypes).toEqual(['P', 'ID'])
    })
  })

  it('refuses an owned DSC that does not cover the document type', async () => {
    await withBackend(async (backend) => {
      await issueCscaSigner(backend, {
        subjectCn: 'Passport Only',
        documentTypes: ['P'],
      })
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect((await backend.client.put('/dsc/settings/mnt', { useNiaDsc: false })).status).toBe(200)

      const reference = await submitRequest(backend, td1SignRequest())
      const metadata = (
        await backend.client.get(`/dsc/requests/${reference}`)
      ).json<RequestMetadata>()
      expect(metadata.dscSelection).toBe('owned')

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const refused = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(refused.status).toBe(409)
      expect(refused.json<{ error: string }>().error).toBe('dsc_document_type_mismatch')
    })
  })

  it('enforces the NIA DSC lifecycle gate', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const pending = await backend.client.post('/dsc/requests', signRequest())
      expect(pending.status).toBe(201)
      const reference = pending.json<{ reference: string }>().reference

      expireNiaDsc(backend)

      const status = await backend.client.get('/dsc/status')
      expect(status.json<{ canIssueDocuments: boolean }>().canIssueDocuments).toBe(false)

      const blocked = await backend.client.post('/dsc/requests', signRequest('L898902D<'))
      expect(blocked.status).toBe(409)
      expect(blocked.json<{ error: string }>().error).toBe('nia_dsc_expired')

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const approve = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(approve.status).toBe(409)
      expect(approve.json<{ error: string }>().error).toBe('nia_dsc_expired')
    })
  })

  it('refuses an owned DSC that belongs to another maintainer', async () => {
    await withBackend(async (backend) => {
      const foreign = await issueCscaSigner(
        backend,
        { subjectCn: 'Other DSC', documentTypes: ['P'] },
        OTHER_USER,
      )
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const reference = await submitRequest(backend, {
        ...signRequest(),
        dscSelection: { mode: 'owned', dscCertId: foreign.id },
      })
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const response = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(response.status).toBe(403)
      expect(response.json<{ error: string }>().error).toBe('forbidden')

      // A colleague in the same MNT is not the owner of the request.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, USER_COLLEAGUE)
      expect((await backend.client.get(`/dsc/requests/${reference}/preview`)).status).toBe(403)
    })
  })
})
