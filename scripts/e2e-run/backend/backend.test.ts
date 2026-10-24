/**
 * Part 2 — backend integration tests over real HTTP.
 *
 * Each test boots the production Fastify app on an ephemeral loopback port
 * (SQLite in-memory, filesystem data dir in a temp directory) and drives it with
 * `fetch`: login, CSCA issuance, revocation/CRL and the applicant delivery flow.
 * Certificates produced by the backend are then verified with `@epass42/pki`,
 * so the two halves of the system meet in the middle.
 */
import { describe, expect, it } from 'vitest'

import {
  isRevoked,
  parseCertificatePem,
  parseCrl,
  validateCertProfile,
  verifyDscAgainstCsca,
} from '@epass42/pki'

import { signRequest } from '../fixtures/documents'
import { loginAs, startBackend, type Backend } from './harness'

/** CSCA realm administrator (MNT from backend/src/test-support.ts). */
const CSCA_ADMIN = {
  sub: 'e2e-csca-admin',
  name: 'E2E CSCA Admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-CSCA-MNT', mnt_by: ['EXAMPLE-CSCA-MNT'] },
}

/** DSC realm applicant. */
const DSC_USER = {
  sub: 'e2e-dsc-user',
  email: 'user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** DSC realm NIA administrator. */
const DSC_ADMIN = {
  sub: 'e2e-dsc-admin',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-DSC-MNT',
    mnt_by: ['EXAMPLE-DSC-MNT'],
  },
}

/** Runs `fn` against a freshly booted backend and always closes it. */
async function withBackend<T>(fn: (backend: Backend) => Promise<T>): Promise<T> {
  const backend = await startBackend()
  try {
    return await fn(backend)
  } finally {
    await backend.close()
  }
}

describe('backend e2e — real HTTP, real backend', () => {
  it('serves health and configuration over HTTP', async () => {
    await withBackend(async (backend) => {
      const health = await backend.client.get('/healthz')
      expect(health.status).toBe(200)
      expect(health.json()).toEqual({ status: 'ok' })

      const config = await backend.client.get('/api/config')
      expect(config.status).toBe(200)
      expect(config.json<{ roles: string[] }>().roles).toContain('csca')
    })
  })

  it('issues, publishes, revokes and CRLs a DSC — verified with packages/pki', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', 'csca-client', CSCA_ADMIN)

      const submit = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'E2E HTTP DSC',
        documentTypes: ['P'],
      })
      expect(submit.status).toBe(201)
      const applicationId = submit.json<{ id: number }>().id

      const approve = await backend.client.post(`/csca/applications/${applicationId}/approve`, {})
      expect(approve.status).toBe(201)
      const approved = approve.json<{ id: number; certPem: string }>()

      const csca = parseCertificatePem(backend.cscaPem())
      const dsc = parseCertificatePem(approved.certPem)
      expect(validateCertProfile(dsc, 'dsc').valid).toBe(true)
      expect((await verifyDscAgainstCsca(dsc, [csca])).valid).toBe(true)

      // The same certificate is downloadable through the registry endpoint and
      // listed in the public PKD directory.
      const download = await backend.client.get(`/csca/certificates/${approved.id}.pem`)
      expect(download.status).toBe(200)
      expect(download.text).toContain('BEGIN CERTIFICATE')
      const pkd = await backend.client.get('/pkd/dscs')
      const listed = pkd
        .json<{ items: { id: number; certificateType: string }[] }>()
        .items.find((entry) => entry.id === approved.id)
      expect(listed?.certificateType).toBe('dsc')

      // Revocation publishes a CRL signed by the CSCA key.
      const revoke = await backend.client.post(`/csca/certificates/${approved.id}/revoke`, {
        reason: 'e2e revocation',
      })
      expect(revoke.status).toBe(200)

      const crlResponse = await backend.client.get('/csca/crl.der')
      expect(crlResponse.status).toBe(200)
      const crl = parseCrl(crlResponse.bytes)
      expect(await crl.verify({ publicKey: csca.publicKey })).toBe(true)
      expect(isRevoked(crl, dsc.serialNumber)).not.toBeNull()
    })
  })

  it('runs the applicant flow: submit → masked preview → approve → one-time reveal', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'dsc', 'dsc-client', DSC_USER)
      const submit = await backend.client.post('/dsc/requests', signRequest('X1234567'))
      expect(submit.status).toBe(201)
      const { reference } = submit.json<{ reference: string }>()

      const preview = await backend.client.get(`/dsc/requests/${reference}/preview`)
      expect(preview.status).toBe(200)
      const masked = preview.json<{ documentNumber: { value: string }; dataGroups: number[] }>()
      expect(masked.documentNumber.value).toContain('*')
      expect(masked.documentNumber.value).not.toBe('X1234567')
      expect(masked.dataGroups).toContain(1)

      await loginAs(backend, 'dsc', 'dsc-client', DSC_ADMIN)
      const approve = await backend.client.post(`/dsc/requests/${reference}/approve`, {})
      expect(approve.status).toBe(200)

      await loginAs(backend, 'dsc', 'dsc-client', DSC_USER)
      const reveal = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(reveal.status).toBe(200)
      expect(reveal.headers.get('cache-control')).toBe('no-store')
      expect(reveal.text).toContain('@dg 1')

      // Claiming is one-time: the second attempt is gone for good.
      const second = await backend.client.post(`/dsc/requests/${reference}/reveal`)
      expect(second.status).toBe(410)
      expect(second.json<{ error: string }>().error).toBe('request_already_consumed')
    })
  })
})
