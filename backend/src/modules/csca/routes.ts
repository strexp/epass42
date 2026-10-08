/**
 * CSCA routes (M5, Appendix D).  Registered as focused handlers:
 *
 *   applications  POST/GET /csca/applications, review
 *   certificates  GET /csca/certificates(/:id.pem|der|private-key), revoke, rollover
 *   crl           GET /csca/crl.(pem|der), POST /csca/crl/generate
 *   settings      GET/PUT /csca/settings/as
 */
import type { FastifyInstance } from 'fastify'

import { registerApplicationRoutes } from './handlers/applications'
import { registerCertificateRoutes } from './handlers/certificates'
import { registerCrlRoutes } from './handlers/crl'
import { registerSettingsRoutes } from './handlers/settings'
import type { CscaRouteDeps } from './routeContext'

/** Registers the CSCA routes. */
export function registerCscaRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  registerApplicationRoutes(app, deps)
  registerCertificateRoutes(app, deps)
  registerCrlRoutes(app, deps)
  registerSettingsRoutes(app, deps)
}

export type { CscaRouteDeps } from './routeContext'
