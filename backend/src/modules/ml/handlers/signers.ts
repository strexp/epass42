/**
 * ML Signer manual rotation.  The certificate inventory is public in the PKD.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { requireAdmin } from '../../auth/middleware'
import type { MlRouteDeps } from '../routeContext'

/** Registers the ML signer routes. */
export function registerSignerRoutes(app: FastifyInstance, deps: MlRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/ml/signers/rotate',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'ml'),
    },
    async (request, reply) => {
      const result = await service.rotateSigner()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'ml',
        action: 'ml.signer.rotate',
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
