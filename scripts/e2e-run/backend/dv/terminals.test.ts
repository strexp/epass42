/**
 * DV realm terminal (Inspection System) scenarios: issuance under the default
 * or a delegated DV, authorization clamping, one-time key export and the NIA
 * DV lifecycle gate.
 */
import { describe, expect, it } from 'vitest'

import { cvPublicKey, parseCvCertificate, verifyCvCertificate } from '@epass42/pki'

import { CLIENT_IDS, CVCA_USER, DV_ADMIN, DV_USER, OTHER_USER } from '../../fixtures/identities'
import {
  allPermissions,
  expireDefaultDv,
  issueDv,
  submitTerminalApplication,
  travelReadOnly,
} from '../actions'
import { loginAs, withBackend, type Backend } from '../harness'
import type { TerminalMetadata } from '../types'

interface TerminalApplicationDetail {
  id: number
  status: string
  hasPrivateKey: boolean
  signingDv: {
    id: number
    source: string
    holderReference: string
    expired: boolean
  } | null
}

/** An issued terminal plus the application that produced it. */
interface IssuedTerminal {
  applicationId: number
  terminal: TerminalMetadata
}

/** Submits and approves a terminal application. */
async function issueTerminalApplication(
  backend: Backend,
  body: Record<string, unknown> = {},
  override: Record<string, unknown> = {},
): Promise<IssuedTerminal> {
  const applicationId = await submitTerminalApplication(backend, body)
  await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
  const approve = await backend.client.post(
    `/dv/terminal-applications/${applicationId}/approve`,
    override,
  )
  expect(approve.status).toBe(201)
  return { applicationId, terminal: approve.json<TerminalMetadata>() }
}

/** Parses a terminal certificate and verifies it against its signing DV. */
async function verifyTerminalChain(
  backend: Backend,
  applicationId: number,
  signingDvId: number,
): Promise<{
  terminal: ReturnType<typeof parseCvCertificate>
  dv: ReturnType<typeof parseCvCertificate>
}> {
  const certificate = await backend.client.get(
    `/dv/terminal-applications/${applicationId}/certificate`,
  )
  expect(certificate.status).toBe(200)
  const terminal = parseCvCertificate(certificate.bytes)

  const dvResponse = await backend.client.get(`/cvca/certificates/${signingDvId}.der`)
  expect(dvResponse.status).toBe(200)
  const dv = parseCvCertificate(dvResponse.bytes)
  expect(await verifyCvCertificate(terminal, await cvPublicKey(dv))).toBe(true)

  const cvcaResponse = await backend.client.get('/pkd/objects/cvca-1.der')
  const cvca = parseCvCertificate(cvcaResponse.bytes)
  expect(await verifyCvCertificate(dv, await cvPublicKey(cvca))).toBe(true)
  return { terminal, dv }
}

describe('backend e2e — DV terminal certificates', () => {
  it('issues a terminal certificate under the default DV and exports its key once', async () => {
    await withBackend(async (backend) => {
      const anonymous = await backend.client.post('/dv/terminal-applications', {
        subjectCn: 'Anonymous IS',
        permissions: allPermissions(),
      })
      expect(anonymous.status).toBe(401)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      const applicationId = await submitTerminalApplication(backend, {
        subjectCn: 'E2E Inspection System',
        holderMnemonic: 'USERIS',
      })
      const pending = await backend.client.get(`/dv/terminal-applications/${applicationId}`)
      expect(pending.status).toBe(200)
      const detail = pending.json<TerminalApplicationDetail>()
      expect(detail.status).toBe('submitted')
      expect(detail.hasPrivateKey).toBe(false)
      expect(detail.signingDv?.source).toBe('system')
      expect(detail.signingDv?.expired).toBe(false)

      const own = await backend.client.get('/dv/terminal-applications')
      expect(own.json<{ scope: string; total: number }>()).toMatchObject({
        scope: 'own',
        total: 1,
      })

      await loginAs(backend, 'dv', CLIENT_IDS.dv, OTHER_USER)
      expect((await backend.client.get(`/dv/terminal-applications/${applicationId}`)).status).toBe(
        403,
      )
      expect(
        (await backend.client.get('/dv/terminal-applications')).json<{ total: number }>().total,
      ).toBe(0)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      expect(
        (await backend.client.post(`/dv/terminal-applications/${applicationId}/approve`, {}))
          .status,
      ).toBe(403)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const approve = await backend.client.post(
        `/dv/terminal-applications/${applicationId}/approve`,
        {},
      )
      expect(approve.status).toBe(201)
      const terminal = approve.json<TerminalMetadata>()
      expect(terminal.source).toBe('owned')
      expect(terminal.hasPrivateKey).toBe(true)
      expect(terminal.permissions).toEqual(allPermissions())
      expect(terminal.holderReference).toMatch(/^XDUSERIS/)
      expect(terminal.authorityReference).toBe(detail.signingDv?.holderReference)

      const chain = await verifyTerminalChain(backend, applicationId, detail.signingDv!.id)
      expect(chain.terminal.role).toBe('terminal')
      expect(chain.terminal.permissions).toEqual(allPermissions())
      expect(chain.dv.role).toBe('dv')

      // The owner downloads the one-time terminal key.
      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      const key = await backend.client.get(`/dv/terminal-applications/${applicationId}/private-key`)
      expect(key.status).toBe(200)
      expect(key.headers.get('cache-control')).toBe('no-store')
      expect(key.text).toContain('BEGIN PRIVATE KEY')
      expect(
        (await backend.client.get(`/dv/terminal-applications/${applicationId}/private-key`)).status,
      ).toBe(410)

      // Reviewing twice is refused.
      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      expect(
        (await backend.client.post(`/dv/terminal-applications/${applicationId}/approve`, {}))
          .status,
      ).toBe(409)
    })
  })

  it('clamps the terminal authorization to the signing DV grant', async () => {
    await withBackend(async (backend) => {
      const dv = await issueDv(
        backend,
        { subjectCn: 'Restricted DV', holderMnemonic: 'RESTR' },
        { permissions: travelReadOnly() },
      )
      expect(dv.permissions).toEqual(travelReadOnly())

      // Delegate terminal issuance to the restricted DV.
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      expect((await backend.client.put('/cvca/settings/mnt', { useNiaDv: false })).status).toBe(200)

      const applicationId = await submitTerminalApplication(backend, {
        subjectCn: 'Restricted IS',
        holderMnemonic: 'RESTRIS',
        permissions: allPermissions(),
      })
      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      const detail = (
        await backend.client.get(`/dv/terminal-applications/${applicationId}`)
      ).json<TerminalApplicationDetail>()
      expect(detail.signingDv).toMatchObject({ id: dv.id, source: 'owned' })

      // The requested all-permissions set is clamped to the DV's grant.
      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const approve = await backend.client.post(
        `/dv/terminal-applications/${applicationId}/approve`,
        { permissions: allPermissions() },
      )
      expect(approve.status).toBe(201)
      const terminal = approve.json<TerminalMetadata>()
      expect(terminal.permissions).toEqual(travelReadOnly())
      expect(terminal.authorityReference).toBe(dv.holderReference)

      const chain = await verifyTerminalChain(backend, applicationId, dv.id)
      expect(chain.terminal.permissions).toEqual(travelReadOnly())
      expect(chain.dv.permissions).toEqual(travelReadOnly())
    })
  })

  it('rejects terminal applications and refuses missing certificates', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      const applicationId = await submitTerminalApplication(backend, {
        subjectCn: 'Rejected IS',
      })

      // An unapproved application has no certificate and no key.
      expect(
        (await backend.client.get(`/dv/terminal-applications/${applicationId}/certificate`)).status,
      ).toBe(404)
      expect(
        (await backend.client.get(`/dv/terminal-applications/${applicationId}/private-key`)).status,
      ).toBe(404)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const reject = await backend.client.post(
        `/dv/terminal-applications/${applicationId}/reject`,
        { reason: 'not an inspection authority' },
      )
      expect(reject.status).toBe(200)
      expect(reject.json<{ status: string }>().status).toBe('rejected')
      expect(
        (await backend.client.post(`/dv/terminal-applications/${applicationId}/approve`, {}))
          .status,
      ).toBe(409)
      expect((await backend.client.get('/dv/terminal-applications/9999')).status).toBe(404)
    })
  })

  it('enforces the NIA DV lifecycle gate even when terminals use an own DV', async () => {
    await withBackend(async (backend) => {
      // Delegate terminal issuance to an own DV before the gate is tested.
      const dv = await issueDv(backend, { subjectCn: 'Gate DV', holderMnemonic: 'GATEDV' })
      await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
      expect((await backend.client.put('/cvca/settings/mnt', { useNiaDv: false })).status).toBe(200)
      expect(dv.source).toBe('owned')

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_USER)
      const pending = await backend.client.post('/dv/terminal-applications', {
        subjectCn: 'Pending IS',
        permissions: allPermissions(),
      })
      expect(pending.status).toBe(201)
      const applicationId = pending.json<{ id: number }>().id

      expireDefaultDv(backend)
      const status = await backend.client.get('/dv/status')
      expect(status.json<{ canIssueTerminals: boolean }>().canIssueTerminals).toBe(false)

      const blocked = await backend.client.post('/dv/terminal-applications', {
        subjectCn: 'Blocked IS',
        permissions: allPermissions(),
      })
      expect(blocked.status).toBe(409)
      expect(blocked.json<{ error: string }>().error).toBe('nia_dv_expired')

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const approve = await backend.client.post(
        `/dv/terminal-applications/${applicationId}/approve`,
        {},
      )
      expect(approve.status).toBe(409)
      expect(approve.json<{ error: string }>().error).toBe('nia_dv_expired')
    })
  })

  it('lists terminal permissions overrides in the audit trail', async () => {
    await withBackend(async (backend) => {
      const { applicationId } = await issueTerminalApplication(backend, {
        subjectCn: 'Audited IS',
      })
      expect(applicationId).toBeGreaterThan(0)

      await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
      const audit = await backend.client.get('/dv/audit?action=terminal.application')
      expect(audit.status).toBe(200)
      const actions = audit.json<{ items: { action: string }[] }>().items.map((item) => item.action)
      expect(actions).toContain('terminal.application.submit')
      expect(actions).toContain('terminal.application.approve')
    })
  })
})
