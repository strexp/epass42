/**
 * CVCA routes (M17, Doc 9303-12 §7.2).  Registered as focused handlers:
 *
 *   applications  POST/GET /cvca/applications, review (with permission override)
 *   certificates  GET /cvca/certificates(/:id.der), private-key; POST /cvca/keys/rollover
 *   settings      GET/PUT /cvca/settings/mnt (default DV / own DV delegation)
 *
 * The CVCA certificates themselves are published through the PKD
 * (`GET /pkd/cvca`), so there is no `/cvca/keys` listing.
 */
import type { FastifyInstance } from 'fastify'

import { registerApplicationRoutes } from './handlers/applications'
import { registerCertificateRoutes } from './handlers/certificates'
import { registerSettingsRoutes } from './handlers/settings'
import type { CvcaRouteDeps } from './routeContext'

/** Registers the CVCA routes. */
export function registerCvcaRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  registerApplicationRoutes(app, deps)
  registerCertificateRoutes(app, deps)
  registerSettingsRoutes(app, deps)
}

export type { CvcaRouteDeps } from './routeContext'
