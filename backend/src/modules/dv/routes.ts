/**
 * DV realm routes (M18): terminal (Inspection System) certificate applications
 * submitted by Document Verifier holders.
 */
import type { FastifyInstance } from 'fastify'

import { registerTerminalApplicationRoutes } from './handlers/terminalApplications'
import type { DvRouteDeps } from './routeContext'

/** Registers the DV routes. */
export function registerDvRoutes(app: FastifyInstance, deps: DvRouteDeps): void {
  registerTerminalApplicationRoutes(app, deps)
}

export type { DvRouteDeps } from './routeContext'
