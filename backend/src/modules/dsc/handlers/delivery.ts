/**
 * DSC delivery routes (M8): masked preview, one-time reveal by reference and
 * the two-step email landing token.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { accessRow, referenceParams, type DscRouteDeps } from '../routeContext'

/** Registers the delivery routes. */
export function registerDeliveryRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get(
    '/dsc/requests/:reference/preview',
    {
      schema: { params: referenceParams },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const access = accessRow(deps, request, row)
      if (!access.ok) {
        return reply
          .code(access.status ?? 403)
          .send({ error: access.status === 401 ? 'unauthorized' : 'forbidden' })
      }
      const preview = service.preview(request.params.reference)
      if (!preview) return reply.code(404).send({ error: 'request_not_found' })
      return reply.send(preview)
    },
  )

  server.post(
    '/dsc/requests/:reference/reveal',
    {
      schema: { params: referenceParams },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const access = accessRow(deps, request, row)
      if (!access.ok) {
        return reply
          .code(access.status ?? 403)
          .send({ error: access.status === 401 ? 'unauthorized' : 'forbidden' })
      }
      const result = service.revealByReference(
        request.params.reference,
        request.principal?.account.id ?? null,
      )
      writeAudit(db, {
        actorAccountId: request.principal?.account.id ?? null,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: result.row.reference,
        ip: request.ip,
        detail: { channel: 'applicant' },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
    },
  )

  // Two-step email landing: view metadata without consuming.
  server.post(
    '/dsc/reveal/:token',
    { schema: { params: z.object({ token: z.string().min(8).max(128) }) } },
    async (request, reply) => {
      const row = service.resolveRevealToken(request.params.token)
      reply.header('cache-control', 'no-store')
      return reply.send(service.metadata(row))
    },
  )
}
