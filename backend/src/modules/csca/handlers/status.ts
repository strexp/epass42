/**
 * CSCA lifecycle status (M5/M6): the current certificate's validity and whether
 * new signer certificates may be issued.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { lifecycleCertificate } from '../../../certificates/status'
import type { CscaRouteDeps } from '../routeContext'
import { currentCscaKey } from '../service'

/** Registers the public CSCA status route. */
export function registerStatusRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.get('/csca/status', async () => {
    const csca = currentCscaKey(db)
    return {
      csca: csca ? lifecycleCertificate(csca, { format: 'x509', certPem: csca.certPem }) : null,
      canIssueCertificates: deps.service.canIssueCertificates(),
    }
  })
}
