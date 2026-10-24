/**
 * NIA Document Signer lifecycle routes (M5): public status and the admin-only
 * manual rotation.  The certificate itself is issued by the CSCA role but the
 * operational owner is the DSC realm.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { lifecycleCertificate } from '../../../certificates/status'
import { writeAudit } from '../../../audit/audit'
import { requireAdmin } from '../../auth/middleware'
import { currentCscaKey, currentNiaDsc } from '../../csca/service'
import type { DscRouteDeps } from '../routeContext'

/** Registers the NIA DSC status and rotation routes. */
export function registerLifecycleRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get('/dsc/status', async () => {
    const nia = currentNiaDsc(db)
    const csca = currentCscaKey(db)
    const niaDsc = nia
      ? lifecycleCertificate(nia, {
          format: 'x509',
          certPem: nia.certPem,
          parentNotAfter: csca?.notAfter,
        })
      : null
    const cscaStatus = csca
      ? lifecycleCertificate(csca, { format: 'x509', certPem: csca.certPem })
      : null
    return {
      niaDsc,
      canIssueDocuments: Boolean(niaDsc && !niaDsc.expired),
      canRotateNiaDsc: Boolean(cscaStatus && !cscaStatus.expired),
      csca: cscaStatus,
    }
  })

  server.post(
    '/dsc/nia-dsc/rotate',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'dsc'),
    },
    async (request, reply) => {
      const result = await service.rotateNiaDsc()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.nia-dsc.rotate',
        targetType: 'dsc_cert',
        targetId: result.current.id,
        ip: request.ip,
        detail: { previous: result.previous?.id ?? null },
      })
      return reply.send({
        previous: result.previous?.id ?? null,
        current: result.current.id,
      })
    },
  )
}
