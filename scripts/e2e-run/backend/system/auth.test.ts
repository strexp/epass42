/**
 * Authentication and deployment-surface scenarios: health, public config,
 * OpenAPI, realm sessions, CSRF logout, role gating and rate limiting.
 */
import { describe, expect, it } from 'vitest'

import { CLIENT_IDS, CSCA_ADMIN, CSCA_USER } from '../../fixtures/identities'
import { loginAs, logoutAs, withBackend } from '../harness'

describe('backend e2e — system and authentication', () => {
  it('serves health, public configuration and the OpenAPI document', async () => {
    await withBackend(async (backend) => {
      const health = await backend.client.get('/healthz')
      expect(health.status).toBe(200)
      expect(health.json()).toEqual({ status: 'ok' })

      const config = await backend.client.get('/api/config')
      expect(config.status).toBe(200)
      const body = config.json<{
        roles: string[]
        countryAlpha2: string
        countryAlpha3: string
        oauthProviders: Record<string, { id: number; alias: string }[]>
      }>()
      expect(body.roles).toEqual(['pkd', 'csca', 'cvca', 'dv', 'dsc', 'ml'])
      expect(body.countryAlpha2).toBe('XD')
      expect(body.countryAlpha3).toBe('XDN')
      for (const realm of ['csca', 'cvca', 'dv', 'dsc', 'ml']) {
        expect(body.oauthProviders[realm]?.length).toBe(1)
        expect(body.oauthProviders[realm]?.[0]?.alias).toBeTruthy()
      }

      const openapi = await backend.client.get('/openapi.json')
      expect(openapi.status).toBe(200)
      const spec = openapi.json<{
        info: { title: string }
        paths: Record<string, unknown>
      }>()
      expect(spec.info.title).toBe('ePass 42 API')
      for (const path of [
        '/healthz',
        '/csca/applications',
        '/cvca/applications',
        '/dv/terminal-applications',
        '/dsc/requests',
        '/ml/status',
        '/pkd/dscs',
      ]) {
        expect(spec.paths).toHaveProperty(path)
      }
    })
  })

  it('keeps realm sessions isolated and reports the administrator scope', async () => {
    await withBackend(async (backend) => {
      const anonymous = await backend.client.get('/auth/csca/me')
      expect(anonymous.status).toBe(401)

      const admin = await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      expect(admin.isAdmin).toBe(true)
      expect(admin.account.activeMnt).toBe('EXAMPLE-CSCA-MNT')
      expect(admin.reviewScope).toBe('none')
      expect(admin.csrf).not.toBe('')
      expect(admin.prefill.activeMnt).toBe('EXAMPLE-CSCA-MNT')
      expect((await backend.client.get('/auth/csca/admin')).status).toBe(200)
      expect((await backend.client.get('/csca/applications')).status).toBe(200)

      // The csca cookie does not open the dsc realm.
      expect((await backend.client.get('/auth/dsc/me')).status).toBe(401)
      expect((await backend.client.get('/dsc/requests')).status).toBe(401)

      // A second client sees none of the csca session.
      const otherClient = backend.createClient()
      expect((await otherClient.get('/auth/csca/me')).status).toBe(401)
      expect((await otherClient.get('/csca/applications')).status).toBe(401)

      // An ordinary maintenance user is authenticated but not an administrator.
      const user = await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect(user.isAdmin).toBe(false)
      expect((await backend.client.get('/auth/csca/admin')).status).toBe(403)
      expect((await backend.client.get('/csca/applications')).status).toBe(200)
    })
  })

  it('requires the session CSRF token to log out', async () => {
    await withBackend(async (backend) => {
      const session = await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)

      const withoutToken = await logoutAs(backend, 'csca')
      expect(withoutToken.status).toBe(403)
      expect(withoutToken.json<{ error: string }>().error).toBe('csrf')
      expect((await backend.client.get('/auth/csca/me')).status).toBe(200)

      const loggedOut = await logoutAs(backend, 'csca', session.csrf)
      expect(loggedOut.status).toBe(204)
      expect((await backend.client.get('/auth/csca/me')).status).toBe(401)
    })
  })

  it('only registers the roles enabled in the deployment', async () => {
    await withBackend(
      async (backend) => {
        const config = await backend.client.get('/api/config')
        expect(config.json<{ roles: string[] }>().roles).toEqual(['pkd', 'csca'])

        expect((await backend.client.get('/auth/cvca/login')).status).toBe(404)
        expect((await backend.client.get('/auth/dv/login')).status).toBe(404)
        expect((await backend.client.get('/cvca/applications')).status).toBe(404)
        expect((await backend.client.get('/dv/terminal-applications')).status).toBe(404)
        expect((await backend.client.get('/dsc/requests')).status).toBe(404)

        // The PKD surface stays public and available.
        expect((await backend.client.get('/pkd/dscs')).status).toBe(200)
        expect((await backend.client.get('/pkd/certificates')).status).toBe(200)
      },
      { roles: ['pkd', 'csca'] },
    )
  })

  it('rate limits public requests when configured', async () => {
    await withBackend(
      async (backend) => {
        const first = await backend.client.get('/healthz')
        const second = await backend.client.get('/healthz')
        const third = await backend.client.get('/healthz')
        expect(first.status).toBe(200)
        expect(second.status).toBe(200)
        expect(third.status).toBe(429)
      },
      { rateLimit: { max: 2, windowMs: 60_000 } },
    )
  })
})
