/**
 * CSCA CRL publication routes (M6): download and manual generation.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { derToPem } from '@pkd42/pki'

import { writeAudit } from '../../../audit/audit'
import { requireAdmin } from '../../auth/middleware'
import type { CscaRouteDeps } from '../routeContext'

/** Registers the CRL routes. */
export function registerCrlRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get('/csca/crl.der', async (_request, reply) => {
    const last = service.latestCrl()
    if (!last) return reply.code(404).send({ error: 'crl_not_found' })
    return reply.type('application/pkix-crl').send(Buffer.from(last.der))
  })

  server.get('/csca/crl.pem', async (_request, reply) => {
    const last = service.latestCrl()
    if (!last) return reply.code(404).send({ error: 'crl_not_found' })
    return reply.type('application/x-pem-file').send(derToPem(new Uint8Array(last.der), 'X509 CRL'))
  })

  server.post(
    '/csca/crl/generate',
    { preHandler: requireAdmin(deps, 'csca') },
    async (request, reply) => {
      const row = await service.generateCrl()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'csca',
        action: 'crl.generate',
        targetType: 'crl',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(201).send({ id: row.id, crlNumber: row.crlNumber })
    },
  )
}
