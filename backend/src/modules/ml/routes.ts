/**
 * Master List routes (M10, now an independent role):
 *
 *   status     GET /ml/status
 *   signers    POST /ml/signers/rotate
 *   masterlist POST /ml/masterlists
 *
 * Every route is administrator-only; the public PKD keeps the read/download
 * endpoints.
 */
import type { FastifyInstance } from 'fastify'

import { registerMasterListRoutes } from './handlers/masterLists'
import { registerSignerRoutes } from './handlers/signers'
import { registerStatusRoutes } from './handlers/status'
import type { MlRouteDeps } from './routeContext'

/** Registers the ML routes. */
export function registerMlRoutes(app: FastifyInstance, deps: MlRouteDeps): void {
  registerStatusRoutes(app, deps)
  registerSignerRoutes(app, deps)
  registerMasterListRoutes(app, deps)
}

export type { MlRouteDeps } from './routeContext'
