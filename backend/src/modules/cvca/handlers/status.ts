/**
 * CVCA lifecycle status (P1): the current CVCA certificate and the system
 * default DV, plus the issuance gates used by the CVCA/DV realms.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { lifecycleCertificate } from '../../../certificates/status'
import { currentCvcaKey } from '../keys'
import { currentDefaultDv } from '../dvIssuance'
import type { CvcaRouteDeps } from '../routeContext'

/** Registers the public CVCA status route. */
export function registerStatusRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get('/cvca/status', async () => {
    const cvca = currentCvcaKey(db)
    const dv = currentDefaultDv(db)
    const cvcaStatus = cvca ? lifecycleCertificate(cvca, { format: 'cv' }) : null
    const defaultDv = dv
      ? lifecycleCertificate(dv, {
          format: 'cv',
          parentNotAfter: cvca?.notAfter,
        })
      : null
    return {
      cvca: cvcaStatus,
      defaultDv,
      canIssueDvs: service.canIssueDvs(),
      canIssueTerminals: service.canIssueTerminals(),
      canRotateCvca: Boolean(cvcaStatus && !cvcaStatus.expired),
    }
  })
}
