/**
 * DSC delivery scenarios: one-time reveal, concurrent claims, masked preview
 * and the single-active-passport lifecycle (self-revocation, supersession and
 * the public revoked-document directory).
 */
import { describe, expect, it } from 'vitest'

import { CLIENT_IDS, DSC_ADMIN, DSC_USER, OTHER_USER } from '../../fixtures/identities'
import { signRequest } from '../../fixtures/documents'
import { approveRequest, issuePassport, submitRequest } from '../actions'
import { loginAs, withBackend } from '../harness'
import type { RequestMetadata } from '../types'

interface PassportResponse {
  passport: (RequestMetadata & { documentNumber: string }) | null
}

describe('backend e2e — DSC delivery', () => {
  it('reveals the personalization exactly once with no-store', async () => {
    await withBackend(async (backend) => {
      const { reference } = await issuePassport(backend, signRequest())
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)

      const preview = await backend.client.get(`/dsc/requests/${reference}/preview`)
      expect(preview.status).toBe(200)
      expect(preview.json<{ documentNumber: { value: string } }>().documentNumber.value).toBe(
        'L8*****C<',
      )

      const reveal = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(reveal.status).toBe(200)
      expect(reveal.headers.get('cache-control')).toBe('no-store')
      expect(reveal.headers.get('content-type')).toContain('text/plain')
      expect(reveal.text).toContain('@dg 1')
      expect(reveal.text).toContain('@sod')
      expect(reveal.text).toContain('L898902C<')

      const second = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(second.status).toBe(410)
      expect(second.json<{ error: string }>().error).toBe('request_already_consumed')

      // Consumption is recorded on the metadata; the preview remains readable.
      const metadata = await backend.client.get(`/dsc/requests/${reference}`)
      expect(metadata.json<RequestMetadata>().consumedAt).not.toBeNull()
      expect((await backend.client.get(`/dsc/requests/${reference}/preview`)).status).toBe(200)
    })
  })

  it('lets exactly one of two concurrent claims win', async () => {
    await withBackend(async (backend) => {
      const { reference } = await issuePassport(backend, signRequest())
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)

      const responses = await Promise.all([
        backend.client.post(`/dsc/requests/${reference}/reveal`),
        backend.client.post(`/dsc/requests/${reference}/reveal`),
      ])
      expect(responses.map((response) => response.status).sort()).toEqual([200, 410])
      const winner = responses.find((response) => response.status === 200)
      const loser = responses.find((response) => response.status === 410)
      expect(winner?.text).toContain('@dg 1')
      expect(loser?.json<{ error: string }>().error).toBe('request_already_consumed')
    })
  })

  it('refuses to reveal before approval or after revocation', async () => {
    await withBackend(async (backend) => {
      const reference = await submitRequest(backend, signRequest())
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)

      const early = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(early.status).toBe(409)
      expect(early.json<{ error: string }>().error).toBe('request_not_approved')

      await approveRequest(backend, reference)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect((await backend.client.get('/dsc/passports/active')).status).toBe(200)

      const revoked = await backend.client.post(`/dsc/passports/${reference}/revoke`, {
        reason: 'lost document',
      })
      expect(revoked.status).toBe(200)
      expect(revoked.json<RequestMetadata>().status).toBe('revoked')

      const after = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(after.status).toBe(409)
      expect(after.json<{ error: string }>().error).toBe('request_not_approved')

      // An invalid landing token is a 404, not a server error.
      const token = await backend.client.post('/dsc/reveal/invalid-token-value')
      expect(token.status).toBe(404)
      expect(token.json<{ error: string }>().error).toBe('token_invalid')
    })
  })

  it('keeps a single active passport and supersedes the previous one', async () => {
    await withBackend(async (backend) => {
      const first = await issuePassport(backend, signRequest('L898902C<'))
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)

      const active = await backend.client.get('/dsc/passports/active')
      expect(active.status).toBe(200)
      const passport = active.json<PassportResponse>().passport
      expect(passport?.reference).toBe(first.reference)
      expect(passport?.documentNumber).toBe('L898902C<')
      expect(passport?.status).toBe('approved')

      // Only the owner or an administrator may revoke it.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, OTHER_USER)
      expect(
        (await backend.client.post(`/dsc/passports/${first.reference}/revoke`, {})).status,
      ).toBe(403)

      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect(
        (await backend.client.post(`/dsc/passports/${first.reference}/revoke`, { reason: 'lost' }))
          .status,
      ).toBe(200)
      expect(
        (await backend.client.get('/dsc/passports/active')).json<PassportResponse>().passport,
      ).toBeNull()

      // A new approval supersedes the previous active document.
      const second = await issuePassport(backend, signRequest('L898902D<'))
      const third = await issuePassport(backend, signRequest('L898902E<'))
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)

      const current = (await backend.client.get('/dsc/passports/active')).json<PassportResponse>()
        .passport
      expect(current?.reference).toBe(third.reference)
      expect(current?.documentNumber).toBe('L898902E<')

      const superseded = await backend.client.get(`/dsc/requests/${second.reference}`)
      expect(superseded.json<RequestMetadata>().status).toBe('revoked')
      expect(superseded.json<RequestMetadata>().revokeReason).toBe('superseded by a new document')

      // The superseded document is on the public revocation list by MRZ hash.
      const check = await backend.client.post('/pkd/revoked/check', {
        documentCode: 'P',
        issuingState: 'XDN',
        documentNumber: 'L898902D<',
        dateOfBirth: '690806',
      })
      expect(check.status).toBe(200)
      expect(check.json<{ revoked: boolean }>().revoked).toBe(true)
      const directory = await backend.client.get('/pkd/revoked')
      expect(
        directory.json<{ items: { hash: string }[] }>().items.map((item) => item.hash),
      ).toContain(check.json<{ hash: string }>().hash)

      // An administrator can revoke any active document.
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      expect(
        (await backend.client.post(`/dsc/passports/${third.reference}/revoke`, { reason: 'admin' }))
          .status,
      ).toBe(200)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect(
        (await backend.client.get('/dsc/passports/active')).json<PassportResponse>().passport,
      ).toBeNull()
    })
  })
  it('serves the two-step landing token without consuming the request', async () => {
    await withBackend(async (backend) => {
      const { reference } = await issuePassport(backend, signRequest())
      const token = backend.built.dsc.createRevealToken(reference, 'confirm', 60)

      const landing = await backend.client.post(`/dsc/reveal/${token}`)
      expect(landing.status).toBe(200)
      expect(landing.headers.get('cache-control')).toBe('no-store')
      const metadata = landing.json<RequestMetadata>()
      expect(metadata.reference).toBe(reference)
      expect(metadata.status).toBe('approved')
      expect(metadata.consumedAt).toBeNull()

      // A confirm token is reusable and never consumes the perso.
      const again = await backend.client.post(`/dsc/reveal/${token}`)
      expect(again.status).toBe(200)
      expect(
        (await backend.client.get(`/dsc/requests/${reference}`)).json<RequestMetadata>().consumedAt,
      ).toBeNull()

      const expired = backend.built.dsc.createRevealToken(reference, 'confirm', -60)
      const gone = await backend.client.post(`/dsc/reveal/${expired}`)
      expect(gone.status).toBe(410)
      expect(gone.json<{ error: string }>().error).toBe('token_expired')
      expect((await backend.client.post('/dsc/reveal/does-not-exist')).status).toBe(404)
    })
  })
})
