/**
 * CVCA scenarios: DV application review with permission override, CV
 * certificate verification, one-time DV key export, CVCA rollover/link
 * certificates and the default-DV delegation.
 */
import { describe, expect, it } from 'vitest'

import {
  cvPublicKey,
  ecPointFromSpki,
  parseCvCertificate,
  pemToDer,
  verifyCvCertificate,
} from '@epass42/pki'

import { CLIENT_IDS, CVCA_ADMIN, CVCA_USER, DV_ADMIN, OTHER_USER } from '../../fixtures/identities'
import { ecCsrPem, ecPublicKeyPem, publicKeyDerOfPrivateKey } from '../../fixtures/keys'
import {
  allPermissions,
  expireCvca,
  issueDv,
  submitDvApplication,
  travelReadOnly,
} from '../actions'
import { loginAs, withBackend, type Backend } from '../harness'
import type { DvMetadata } from '../types'

/** Downloads and parses a CVCA/DV object from the PKD. */
async function pkdCv(backend: Backend, id: string): Promise<ReturnType<typeof parseCvCertificate>> {
  const response = await backend.client.get(`/pkd/objects/${id}.der`)
  expect(response.status).toBe(200)
  return parseCvCertificate(response.bytes)
}

describe('backend e2e — CVCA and DV lifecycle', () => {
  it('reviews a DV application, applies overrides and exports the key once', async () => {
    await withBackend(async (backend) => {
      const anonymous = await backend.client.post('/cvca/applications', {
        subjectCn: 'Anonymous DV',
        permissions: allPermissions(),
      })
      expect(anonymous.status).toBe(401)

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      const submit = await backend.client.post('/cvca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'E2E Document Verifier',
        holderMnemonic: 'USERDV',
        dvClass: 'domestic',
        permissions: allPermissions(),
        applicationUrl: 'https://user.example.net/dv',
      })
      expect(submit.status).toBe(201)
      const id = submit.json<{ id: number }>().id

      const own = await backend.client.get('/cvca/applications')
      expect(own.json<{ scope: string; total: number }>().scope).toBe('own')
      expect(own.json<{ total: number }>().total).toBe(1)

      const detail = await backend.client.get(`/cvca/applications/${id}`)
      expect(detail.status).toBe(200)
      expect(detail.json<{ hasPrivateKey: boolean }>().hasPrivateKey).toBe(false)

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, OTHER_USER)
      expect((await backend.client.get(`/cvca/applications/${id}`)).status).toBe(403)
      expect((await backend.client.get('/cvca/applications')).json<{ total: number }>().total).toBe(
        0,
      )

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      expect((await backend.client.post(`/cvca/applications/${id}/approve`, {})).status).toBe(403)

      // The reviewer replaces the requested profile with a restricted, foreign DV.
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      const approve = await backend.client.post(`/cvca/applications/${id}/approve`, {
        permissions: travelReadOnly(),
        dvClass: 'foreign',
      })
      expect(approve.status).toBe(201)
      const dv = approve.json<DvMetadata>()
      expect(dv.permissions).toEqual(travelReadOnly())
      expect(dv.dvClass).toBe('foreign')
      expect(dv.source).toBe('owned')
      expect(dv.mnt).toBe('USER-MNT')
      expect(dv.hasPrivateKey).toBe(true)
      expect(dv.applicationUrl).toBe('https://user.example.net/dv')
      expect(dv.holderReference).toMatch(/^XDUSERDV/)

      // The CV certificate chains to the current CVCA and carries the grant.
      const der = await backend.client.get(`/cvca/certificates/${dv.id}.der`)
      expect(der.status).toBe(200)
      const parsed = parseCvCertificate(der.bytes)
      expect(parsed.role).toBe('dv')
      expect(parsed.dvClass).toBe('foreign')
      expect(parsed.permissions).toEqual(travelReadOnly())
      const cvca = await pkdCv(backend, 'cvca-1')
      expect(await verifyCvCertificate(parsed, await cvPublicKey(cvca))).toBe(true)

      // The private key is exportable once, by the owner or the administrator.
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      const key = await backend.client.get(`/cvca/certificates/${dv.id}/private-key`)
      expect(key.status).toBe(200)
      expect(key.headers.get('cache-control')).toBe('no-store')
      expect(key.text).toContain('BEGIN PRIVATE KEY')
      expect(await ecPointFromSpki(publicKeyDerOfPrivateKey(key.text), 'P-256')).toEqual(
        parsed.publicKey.algorithm === 'ec' ? parsed.publicKey.point : new Uint8Array(),
      )
      expect((await backend.client.get(`/cvca/certificates/${dv.id}/private-key`)).status).toBe(410)

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      expect((await backend.client.post(`/cvca/applications/${id}/approve`, {})).status).toBe(409)
      expect(
        (await backend.client.get('/pkd/dvs')).json<{ items: (DvMetadata & { id: string })[] }>()
          .items,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `dv-${dv.id}`, dvClass: 'foreign' }),
        ]),
      )
    })
  })

  it('accepts an uploaded EC key and rejects malformed applications', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)

      const missing = await backend.client.post('/cvca/applications', {
        keyMode: 'user_uploaded',
        subjectCn: 'No Key DV',
        permissions: allPermissions(),
      })
      expect(missing.status).toBe(400)
      expect(missing.json<{ error: string }>().error).toBe('csr_or_public_key_required')

      const invalidMnemonic = await backend.client.post('/cvca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Bad DV',
        holderMnemonic: 'TOO-LONG!',
        permissions: allPermissions(),
      })
      expect(invalidMnemonic.status).toBe(400)

      const publicKeyPem = await ecPublicKeyPem()
      const submit = await backend.client.post('/cvca/applications', {
        keyMode: 'user_uploaded',
        subjectCn: 'Uploaded DV',
        publicKeyPem,
        permissions: allPermissions(),
      })
      expect(submit.status).toBe(201)
      const id = submit.json<{ id: number }>().id

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      const approve = await backend.client.post(`/cvca/applications/${id}/approve`, {})
      expect(approve.status).toBe(201)
      const dv = approve.json<DvMetadata>()
      expect(dv.keyMode).toBe('user_uploaded')
      expect(dv.hasPrivateKey).toBe(false)

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      const missingKey = await backend.client.get(`/cvca/certificates/${dv.id}/private-key`)
      expect(missingKey.status).toBe(404)
      expect(missingKey.json<{ error: string }>().error).toBe('no_private_key')

      const der = await backend.client.get(`/cvca/certificates/${dv.id}.der`)
      const parsed = parseCvCertificate(der.bytes)
      expect(parsed.publicKey.algorithm).toBe('ec')
      expect(await ecPointFromSpki(pemToDer(publicKeyPem), 'P-256')).toEqual(
        parsed.publicKey.algorithm === 'ec' ? parsed.publicKey.point : new Uint8Array(),
      )

      // The CSR path is equivalent to a bare SPKI.
      const csr = await ecCsrPem('CSR DV')
      const csrSubmit = await backend.client.post('/cvca/applications', {
        keyMode: 'user_uploaded',
        subjectCn: 'CSR DV',
        csrPem: csr.csrPem,
        permissions: allPermissions(),
      })
      expect(csrSubmit.status).toBe(201)
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      const csrApprove = await backend.client.post(
        `/cvca/applications/${csrSubmit.json<{ id: number }>().id}/approve`,
        {},
      )
      expect(csrApprove.status).toBe(201)
      const csrDer = await backend.client.get(
        `/cvca/certificates/${csrApprove.json<DvMetadata>().id}.der`,
      )
      const csrParsed = parseCvCertificate(csrDer.bytes)
      expect(csrParsed.publicKey.algorithm).toBe('ec')
      expect(await ecPointFromSpki(csr.publicKeyDer, 'P-256')).toEqual(
        csrParsed.publicKey.algorithm === 'ec' ? csrParsed.publicKey.point : new Uint8Array(),
      )

      // Rejections record the reason and are terminal.
      const second = await submitDvApplication(backend, { subjectCn: 'Rejected DV' })
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      const reject = await backend.client.post(`/cvca/applications/${second}/reject`, {
        reason: 'maintainer is not a DV',
      })
      expect(reject.status).toBe(200)
      expect(reject.json<{ status: string }>().status).toBe('rejected')
      expect((await backend.client.post(`/cvca/applications/${second}/approve`, {})).status).toBe(
        409,
      )
      expect(
        (await backend.client.post('/cvca/applications/9999/reject', { reason: 'x' })).status,
      ).toBe(404)
    })
  })

  it('rolls the CVCA over with a link certificate', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      expect((await backend.client.post('/cvca/keys/rollover', { confirm: true })).status).toBe(403)

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      expect((await backend.client.post('/cvca/keys/rollover', { confirm: false })).status).toBe(
        400,
      )
      const rollover = await backend.client.post('/cvca/keys/rollover', { confirm: true })
      expect(rollover.status).toBe(200)
      const ids = rollover.json<{ previous: number; link: number; current: number }>()
      expect(new Set([ids.previous, ids.link, ids.current]).size).toBe(3)

      const previous = await pkdCv(backend, `cvca-${ids.previous}`)
      const link = await pkdCv(backend, `cvca-${ids.link}`)
      const current = await pkdCv(backend, `cvca-${ids.current}`)
      expect(await verifyCvCertificate(previous, await cvPublicKey(previous))).toBe(true)
      expect(link.authorityReference).toBe(previous.holderReference)
      expect(await verifyCvCertificate(link, await cvPublicKey(previous))).toBe(true)
      expect(link.holderReference).toBe(current.holderReference)
      expect(await verifyCvCertificate(current, await cvPublicKey(current))).toBe(true)
      expect(current.role).toBe('cvca')

      const published = await backend.client.get('/pkd/cvca')
      expect(published.status).toBe(200)
      expect(published.json<{ total: number }>().total).toBe(3)
      expect(published.json<{ items: { id: string; status: string }[] }>().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `cvca-${ids.previous}`, status: 'retired' }),
          expect.objectContaining({ id: `cvca-${ids.link}`, status: 'link' }),
          expect.objectContaining({ id: `cvca-${ids.current}`, status: 'current' }),
        ]),
      )

      const status = await backend.client.get('/dv/status')
      expect(status.json<{ cvca: { id: number } }>().cvca.id).toBe(ids.current)
      expect(status.json<{ canRotateNiaDv: boolean }>().canRotateNiaDv).toBe(true)
    })
  })

  it('delegates terminals to the default DV and rotates it', async () => {
    await withBackend(async (backend) => {
      const initial = await backend.client.get('/dv/status')
      expect(initial.json<{ canIssueTerminals: boolean }>().canIssueTerminals).toBe(true)
      const previous = initial.json<{ niaDv: { id: number } }>().niaDv.id

      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      const delegation = await backend.client.get('/cvca/settings/mnt')
      expect(delegation.json()).toEqual({
        mnt: 'USER-MNT',
        useNiaDv: true,
        hasActiveDv: false,
      })
      const missing = await backend.client.put('/cvca/settings/mnt', { useNiaDv: false })
      expect(missing.status).toBe(409)
      expect(missing.json<{ error: string }>().error).toBe('no_active_dv')

      const dv = await issueDv(backend, { subjectCn: 'Delegated DV' })
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      const optedOut = await backend.client.put('/cvca/settings/mnt', { useNiaDv: false })
      expect(optedOut.status).toBe(200)
      expect(optedOut.json<{ useNiaDv: boolean; hasActiveDv: boolean }>()).toMatchObject({
        useNiaDv: false,
        hasActiveDv: true,
      })
      expect(dv.source).toBe('owned')

      // A cvca administrator is not a dv administrator.
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
      expect((await backend.client.post('/dv/nia-dv/rotate', { confirm: true })).status).toBe(401)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const rotated = await backend.client.post('/dv/nia-dv/rotate', { confirm: true })
      expect(rotated.status).toBe(200)
      const ids = rotated.json<{ previous: number | null; current: number }>()
      expect(ids.previous).toBe(previous)
      expect(ids.current).not.toBe(previous)

      const status = await backend.client.get('/dv/status')
      expect(status.json<{ niaDv: { id: number; status: string } }>().niaDv).toMatchObject({
        id: ids.current,
        status: 'active',
      })
      expect(status.json<{ canIssueTerminals: boolean }>().canIssueTerminals).toBe(true)

      const dvs = (await backend.client.get('/pkd/dvs')).json<{
        items: { id: string; status: string; source: string }[]
      }>()
      expect(dvs.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `dv-${previous}`, status: 'retired', source: 'system' }),
          expect.objectContaining({ id: `dv-${ids.current}`, status: 'active', source: 'system' }),
        ]),
      )
    })
  })

  it('blocks the default-DV rotation when the CVCA is expired', async () => {
    await withBackend(async (backend) => {
      expireCvca(backend)
      const status = await backend.client.get('/dv/status')
      expect(status.json<{ canRotateNiaDv: boolean }>().canRotateNiaDv).toBe(false)
      expect(status.json<{ cvca: { expired: boolean } }>().cvca.expired).toBe(true)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const rotate = await backend.client.post('/dv/nia-dv/rotate', { confirm: true })
      expect(rotate.status).toBe(409)
      expect(rotate.json<{ error: string }>().error).toBe('cvca_expired')
    })
  })
})
