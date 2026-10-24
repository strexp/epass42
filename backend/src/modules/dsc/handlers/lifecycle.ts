/**
 * NIA Document Signer lifecycle routes (M5): public status and the admin-only
 * manual rotation.  The certificate itself is issued by the CSCA role but the
 * operational owner is the DSC realm.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { certificateValidity } from '../../../util/certificate'
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
    const niaValidity = certificateValidity(nia?.notAfter)
    const cscaValidity = certificateValidity(csca?.notAfter)
    return {
      niaDsc: nia
        ? {
            id: nia.id,
            serial: nia.serial,
            status: nia.status,
            ...niaValidity,
          }
        : null,
      canIssueDocuments: nia !== undefined && !niaValidity.expired,
      canRotateNiaDsc: csca !== undefined && !cscaValidity.expired,
      csca: csca
        ? {
            id: csca.id,
            serial: csca.serial,
            ...cscaValidity,
          }
        : null,
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
