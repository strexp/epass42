/**
 * Audit-trail scenarios: every state-changing action writes an entry that only
 * the realm administrator can read, with action-prefix filtering and paging.
 */
import { describe, expect, it } from 'vitest'

import { CLIENT_IDS, CSCA_ADMIN, CSCA_USER, DSC_ADMIN, DSC_USER } from '../../fixtures/identities'
import { signRequest } from '../../fixtures/documents'
import { loginAs, withBackend } from '../harness'

interface AuditPage {
  total: number
  items: {
    action: string
    actor: string | null
    actorMnt: string | null
    targetType: string | null
    detail: unknown
  }[]
}

describe('backend e2e — audit trail', () => {
  it('records and exposes realm actions to administrators only', async () => {
    await withBackend(async (backend) => {
      // Anonymous and ordinary users cannot read the trail.
      expect((await backend.client.get('/csca/audit')).status).toBe(401)
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_USER)
      expect((await backend.client.get('/csca/audit')).status).toBe(403)

      // A regular submit is audited.
      const submit = await backend.client.post('/csca/applications', {
        keyMode: 'remote_generated',
        subjectCn: 'Audited DSC',
        documentTypes: ['P'],
      })
      expect(submit.status).toBe(201)

      // The csca admin can read it; the filter is a prefix.
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const all = await backend.client.get('/csca/audit')
      expect(all.status).toBe(200)
      const page = all.json<AuditPage>()
      expect(page.total).toBeGreaterThanOrEqual(2)
      expect(page.items.map((item) => item.action)).toContain('auth.login')
      expect(page.items.map((item) => item.action)).toContain('dsc.application.submit')

      const filtered = await backend.client.get('/csca/audit?action=dsc.application')
      const filteredPage = filtered.json<AuditPage>()
      expect(filteredPage.total).toBe(1)
      expect(filteredPage.items[0]?.action).toBe('dsc.application.submit')
      expect(filteredPage.items[0]?.actorMnt).toBe('USER-MNT')
      expect(filteredPage.items[0]?.targetType).toBe('dsc_application')

      const paged = await backend.client.get('/csca/audit?limit=1')
      expect(paged.json<AuditPage>().items).toHaveLength(1)
      expect(paged.json<AuditPage>().total).toBe(page.total)

      // A different realm has its own trail and requires its own session.
      expect((await backend.client.get('/dsc/audit')).status).toBe(401)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      const submitted = await backend.client.post('/dsc/requests', signRequest())
      expect(submitted.status).toBe(201)
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_ADMIN)
      const dscAudit = await backend.client.get('/dsc/audit?action=dsc.request')
      expect(dscAudit.status).toBe(200)
      expect(dscAudit.json<AuditPage>().items[0]?.action).toBe('dsc.request.submit')
      expect(dscAudit.json<AuditPage>().items[0]?.detail).toBeNull()
    })
  })
})
