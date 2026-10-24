/**
 * Master list generation.  Querying and downloading stay in the public PKD.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { requireAdmin } from '../../auth/middleware'
import type { MlRouteDeps } from '../routeContext'

/** Registers the master-list generation route. */
export function registerMasterListRoutes(app: FastifyInstance, deps: MlRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/ml/masterlists',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'ml'),
    },
    async (request, reply) => {
      const row = await service.generateMasterList()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'ml',
        action: 'ml.masterlist.generate',
        targetType: 'master_list',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(201).send({ id: `ml-${row.id}`, signerId: row.signerDscId })
    },
  )
}
