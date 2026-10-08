/**
 * DSC signing routes (M7, Appendix D).  Registered as focused handlers:
 *
 *   requests   POST/GET /dsc/requests, status, preview, reveal, jurisdiction
 *   review     approve/reject/regenerate, the mode-B queue and admin reveal
 *   delivery   reference preview/reveal and the two-step email token
 *   settings   delivery mode, issuing profile and maintainer delegation
 */
import type { FastifyInstance } from 'fastify'

import { registerRequestRoutes } from './handlers/requests'
import { registerReviewRoutes } from './handlers/review'
import { registerDeliveryRoutes } from './handlers/delivery'
import { registerSettingsRoutes } from './handlers/settings'
import type { DscRouteDeps } from './routeContext'

/** Registers the DSC signing routes. */
export function registerDscRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  registerRequestRoutes(app, deps)
  registerReviewRoutes(app, deps)
  registerDeliveryRoutes(app, deps)
  registerSettingsRoutes(app, deps)
}

export type { DscRouteDeps } from './routeContext'
export type { SignRequestRow } from './service'
