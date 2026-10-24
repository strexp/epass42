/**
 * ML lifecycle status: signer validity, the latest master list and whether the
 * administrator may generate or rotate.  All ML routes are administrator-only.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { requireAdmin } from '../../auth/middleware'
import type { MlRouteDeps } from '../routeContext'

/** Registers the ML status route. */
export function registerStatusRoutes(app: FastifyInstance, deps: MlRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/ml/status', { preHandler: requireAdmin(deps, 'ml') }, async () =>
    deps.service.status(),
  )
}
