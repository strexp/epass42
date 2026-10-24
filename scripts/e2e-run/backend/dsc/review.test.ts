/**
 * DSC review scenarios: reviewer scope, approve/reject/regenerate, delegated
 * maintainer review, delivery-mode B and the issuing-profile settings.
 */
import { describe, expect, it } from 'vitest'

import {
  CLIENT_IDS,
  DSC_ADMIN,
  DSC_USER,
  OTHER_USER,
  USER_COLLEAGUE,
} from '../../fixtures/identities'
import { MRZ, signRequest } from '../../fixtures/documents'
import { approveRequest, submitRequest } from '../actions'
import { loginAs, withBackend } from '../harness'
import type { RequestMetadata } from '../types'

interface ReviewDetail extends RequestMetadata {
  payload: { mrz: { documentNumber: string; surname: string }; dg2: { width: number } }
}

interface AdminQueue {
  items: RequestMetadata[]
}

describe('backend e2e — DSC review', () => {
  it('exposes the unmasked submission only to reviewers', async () => {
    await withBackend(async (backend) => {
      const reference = await submitRequest(backend, signRequest())

      // The owner cannot read the reviewer view, and neither can a stranger.
      expect((await backend.client.get(`/dsc/requests/${reference}/review`)).status).toBe(403)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, OTHER_USER)
      expect((await backend.client.get(`/dsc/requests/${reference}/review`)).status).toBe(403)
      const anonymous = backend.createClient()
      expect((await anonymous.get(`/dsc/requests/${reference}/review`)).status).toBe(401)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const review = await backend.client.get(`/dsc/requests/${reference}/review`)
      expect(review.status).toBe(200)
      const detail = review.json<ReviewDetail>()
      expect(detail.payload.mrz.documentNumber).toBe(MRZ.documentNumber)
      expect(detail.payload.mrz.surname).toBe('ERIKSSON')
      expect(detail.payload.dg2.width).toBe(240)
      expect(detail.dataGroups).toEqual([1, 2, 12])

      const approved = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(approved.status).toBe(200)
      const metadata = approved.json<RequestMetadata>()
      expect(metadata.status).toBe('approved')
      expect(metadata.reviewedAt).not.toBeNull()
      expect(metadata.deliveryMode).toBe('applicant')

      const again = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(again.status).toBe(409)
      expect(again.json<{ error: string }>().error).toBe('request_not_reviewable')
      expect((await backend.client.get('/dsc/requests/unknown-referenc/review')).status).toBe(404)
    })
  })

  it('rejects, explains and regenerates a request', async () => {
    await withBackend(async (backend) => {
      const rejectedRef = await submitRequest(backend, signRequest())
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const rejected = await backend.client.post(`/dsc/requests/${rejectedRef}/reject`, {
        reason: 'photo is a placeholder',
      })
      expect(rejected.status).toBe(200)
      expect(rejected.json<{ status: string }>().status).toBe('rejected')

      const status = await backend.client.get(`/dsc/requests/${rejectedRef}`)
      expect(status.json<RequestMetadata>().rejectReason).toBe('photo is a placeholder')
      expect(
        (await backend.client.post(`/dsc/requests/${rejectedRef}/regenerate`, {})).status,
      ).toBe(409)

      // Regeneration rebuilds the artifact of an approved request.
      const reference = await submitRequest(backend, signRequest('L898902D<'))
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      expect((await backend.client.post(`/dsc/requests/${reference}/approve`, {})).status).toBe(200)
      const regenerated = await backend.client.post(`/dsc/requests/${reference}/regenerate`, {})
      expect(regenerated.status).toBe(200)
      const metadata = regenerated.json<RequestMetadata>()
      expect(metadata.status).toBe('approved')
      expect(metadata.consumedAt).toBeNull()

      // Only an administrator may regenerate.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect((await backend.client.post(`/dsc/requests/${reference}/regenerate`, {})).status).toBe(
        403,
      )
      expect((await backend.client.post('/dsc/requests/nope/regenerate', {})).status).toBe(400)
    })
  })

  it('lets a delegated maintainer review its own jurisdictions', async () => {
    await withBackend(async (backend) => {
      // Delegating to the NIA DSC records the maintainer as a reviewer.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const delegation = await backend.client.put('/dsc/settings/mnt', { useNiaDsc: true })
      expect(delegation.status).toBe(200)

      const colleagueRef = await submitRequest(backend, signRequest(), USER_COLLEAGUE)
      const foreignRef = await submitRequest(backend, signRequest('L898902E<'), OTHER_USER)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const me = await backend.client.get('/auth/dsc/me')
      expect(me.json<{ reviewScope: string }>().reviewScope).toBe('mnt')

      // The scope lists only the maintainer's requests.
      const list = await backend.client.get('/dsc/requests')
      const items = list.json<{ items: RequestMetadata[] }>().items
      expect(items.map((item) => item.reference)).toEqual([colleagueRef])
      expect((await backend.client.get(`/dsc/requests/${foreignRef}/review`)).status).toBe(403)
      expect((await backend.client.get('/dsc/admin/requests')).status).toBe(403)

      const review = await backend.client.get(`/dsc/requests/${colleagueRef}/review`)
      expect(review.status).toBe(200)

      // A delegated reviewer cannot change delivery mode or profile overrides.
      const settingsChange = await backend.client.post(`/dsc/requests/${colleagueRef}/approve`, {
        deliveryMode: 'reviewer',
      })
      expect(settingsChange.status).toBe(403)
      expect(settingsChange.json<{ error: string }>().error).toBe('forbidden_settings')

      const approved = await backend.client.post(`/dsc/requests/${colleagueRef}/approve`, {})
      expect(approved.status).toBe(200)
      expect(approved.json<RequestMetadata>().deliveryMode).toBe('applicant')

      // An unrelated maintainer never enters the scope.
      expect((await backend.client.get(`/dsc/requests/${foreignRef}/review`)).status).toBe(403)
    })
  })

  it('manages delivery mode and issuing-profile settings', async () => {
    await withBackend(async (backend) => {
      // Settings are administrator-only.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect((await backend.client.get('/dsc/settings/delivery-mode')).status).toBe(403)
      expect(
        (await backend.client.put('/dsc/settings/delivery-mode', { deliveryMode: 'reviewer' }))
          .status,
      ).toBe(403)
      expect((await backend.client.get('/dsc/settings/issuing-profile')).status).toBe(403)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      expect((await backend.client.get('/dsc/settings/delivery-mode')).json()).toEqual({
        deliveryMode: 'applicant',
      })
      const updated = await backend.client.put('/dsc/settings/delivery-mode', {
        deliveryMode: 'reviewer',
      })
      expect(updated.status).toBe(200)
      expect(updated.json<{ deliveryMode: string }>().deliveryMode).toBe('reviewer')

      const profile = await backend.client.put('/dsc/settings/issuing-profile', {
        issuingAuthority: 'XDN TEST AUTHORITY',
        personalizationDevice: 'E2E PERSO',
        validityYears: 7,
        dg2MaxBytes: 20_000,
        lds2: { enabled: true, roles: ['travel', 'visa'] },
        endorsements: 'E2E',
        security: {
          pace: { ecdhGm3des: true, ecdhGmAes128: false },
          aa: { enabled: true, algorithm: 'ecdsa' },
          ca: { enabled: true, keyId: 7 },
        },
      })
      expect(profile.status).toBe(200)
      const body = profile.json<{
        issuingAuthority: string
        personalizationDevice: string
        validityYears: number
        dg2MaxBytes: number
        endorsements: string
        lds2: { enabled: boolean; roles: string[] }
        security: {
          pace: { ecdhGm3des: boolean; ecdhGmAes128: boolean }
          aa: { enabled: boolean; algorithm: string }
          ca: { enabled: boolean; keyId: number }
          ta: { enabled: boolean }
        }
      }>()
      expect(body.issuingAuthority).toBe('XDN TEST AUTHORITY')
      expect(body.personalizationDevice).toBe('E2E PERSO')
      expect(body.validityYears).toBe(7)
      expect(body.dg2MaxBytes).toBe(20_000)
      expect(body.endorsements).toBe('E2E')
      expect(body.lds2).toEqual({ enabled: true, roles: ['travel', 'visa'] })
      expect(body.security.pace).toEqual({ ecdhGm3des: true, ecdhGmAes128: false })
      expect(body.security.aa).toEqual({ enabled: true, algorithm: 'ecdsa' })
      expect(body.security.ca).toEqual({ enabled: true, keyId: 7 })
      expect(body.security.ta.enabled).toBe(false)

      const reread = await backend.client.get('/dsc/settings/issuing-profile')
      expect(reread.json<{ issuingAuthority: string }>().issuingAuthority).toBe(
        'XDN TEST AUTHORITY',
      )
    })
  })

  it('queues mode-B requests and delivers them to the reviewer', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      await backend.client.put('/dsc/settings/delivery-mode', { deliveryMode: 'reviewer' })

      // The delivery mode is snapshotted at submission.
      const reference = await submitRequest(backend, signRequest())
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const queueBefore = await backend.client.get('/dsc/admin/requests')
      expect(queueBefore.json<AdminQueue>().items).toHaveLength(0)

      const approved = await approveRequest(backend, reference)
      expect(approved.deliveryMode).toBe('reviewer')

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const refused = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(refused.status).toBe(403)
      expect(refused.json<{ error: string }>().error).toBe('reveal_not_allowed')
      expect((await backend.client.get('/dsc/admin/requests')).status).toBe(403)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const queue = await backend.client.get('/dsc/admin/requests')
      expect(queue.json<AdminQueue>().items.map((item) => item.reference)).toEqual([reference])

      const reveal = await backend.client.post(`/dsc/admin/requests/${reference}/reveal`)
      expect(reveal.status).toBe(200)
      expect(reveal.headers.get('cache-control')).toBe('no-store')
      expect(reveal.text).toContain('@dg 1')
      expect(reveal.text).toContain('@doc')

      const second = await backend.client.post(`/dsc/admin/requests/${reference}/reveal`)
      expect(second.status).toBe(410)
      expect(
        (await backend.client.get('/dsc/admin/requests')).json<AdminQueue>().items,
      ).toHaveLength(0)
    })
  })
})
