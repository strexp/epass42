/**
 * NIA (system default) DV lifecycle routes (M17/M18): public status and the
 * admin-only manual rotation used by the DV realm that issues IS certificates.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { certificateValidity } from '../../../util/certificate'
import { writeAudit } from '../../../audit/audit'
import { requireAdmin } from '../../auth/middleware'
import { currentCvcaKey, currentDefaultDv } from '../../cvca/service'
import type { DvRouteDeps } from '../routeContext'

/** Registers the NIA DV status and rotation routes. */
export function registerLifecycleRoutes(app: FastifyInstance, deps: DvRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get('/dv/status', async () => {
    const dv = currentDefaultDv(db)
    const cvca = currentCvcaKey(db)
    const dvValidity = certificateValidity(dv?.notAfter)
    const cvcaValidity = certificateValidity(cvca?.notAfter)
    return {
      niaDv: dv
        ? {
            id: dv.id,
            holderReference: dv.holderReference,
            status: dv.status,
            ...dvValidity,
          }
        : null,
      canIssueTerminals: dv !== undefined && !dvValidity.expired,
      canRotateNiaDv: cvca !== undefined && !cvcaValidity.expired,
      cvca: cvca
        ? {
            id: cvca.id,
            holderReference: cvca.holderReference,
            ...cvcaValidity,
          }
        : null,
    }
  })

  server.post(
    '/dv/nia-dv/rotate',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'dv'),
    },
    async (request, reply) => {
      const result = await service.rotateDefaultDv()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dv',
        action: 'dv.nia-dv.rotate',
        targetType: 'dv_cert',
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
