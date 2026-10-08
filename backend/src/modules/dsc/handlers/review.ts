/**
 * DSC review routes (M7): approve, reject, regenerate and the mode-B queue.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { canReview } from '../../auth/authorization'
import { requireAdmin } from '../../auth/middleware'
import type { IssuingDefaults } from '../build'
import { scopeOf, idParams, type DscRouteDeps } from '../routeContext'

/** Registers the review routes. */
export function registerReviewRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/dsc/requests/:id/approve',
    {
      schema: {
        params: idParams,
        body: z
          .object({
            deliveryMode: z.enum(['applicant', 'reviewer']).optional(),
            profileOverrides: z.record(z.string(), z.string()).optional(),
          })
          .default({}),
      },
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!scope || !principal) return reply.code(401).send({ error: 'unauthorized' })
      if (!canReview(scope, { mnt: row.mnt, dscSelection: row.dscSelection })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (scope.kind !== 'nia' && (request.body.deliveryMode || request.body.profileOverrides)) {
        return reply.code(403).send({ error: 'forbidden_settings' })
      }
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'request_not_reviewable' })
      const updated = await service.approve(row, principal.account.id, {
        deliveryMode: request.body.deliveryMode,
        profileOverrides: request.body.profileOverrides as Partial<IssuingDefaults> | undefined,
      })
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.request.approve',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })

      // Email notification with a two-step (non-consuming) landing link.
      if (updated.email && deps.mailer) {
        const confirmToken = service.createRevealToken(updated.id, 'confirm', 7 * 86_400)
        service.createMailToken(updated.id, 'approved', 7 * 86_400)
        const link = `${deps.config.publicUrl.replace(/\/$/, '')}/dsc/reveal/${confirmToken}`
        await deps.mailer
          .send({
            to: updated.email,
            subject: 'pkd42: your signing request was approved',
            text:
              `Your signing request was approved.\n\n` +
              `Open this link to view the details before claiming (claiming is one-time):\n${link}\n`,
          })
          .catch(() => undefined)
        writeAudit(db, {
          actorAccountId: principal.account.id,
          realm: 'dsc',
          action: 'dsc.request.email',
          targetType: 'sign_request',
          targetId: row.id,
          ip: request.ip,
        })
      }
      return reply.send({ id: updated.id, ...service.metadata(updated) })
    },
  )

  server.post(
    '/dsc/requests/:id/reject',
    {
      schema: {
        params: idParams,
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!scope || !principal) return reply.code(401).send({ error: 'unauthorized' })
      if (!canReview(scope, { mnt: row.mnt, dscSelection: row.dscSelection })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      service.reject(row, principal.account.id, request.body.reason)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.request.reject',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.send({ id: row.id, status: 'rejected' })
    },
  )

  server.post(
    '/dsc/requests/:id/regenerate',
    {
      schema: { params: idParams, body: z.object({}).default({}) },
      preHandler: requireAdmin(deps, 'dsc'),
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      if (row.status !== 'approved') return reply.code(409).send({ error: 'request_not_approved' })
      const updated = await service.regenerate(row, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.regenerate',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.send({ id: updated.id, ...service.metadata(updated) })
    },
  )

  server.get('/dsc/admin/requests', { preHandler: requireAdmin(deps, 'dsc') }, async () => {
    const items = service.adminQueue().map((row) => service.metadata(row))
    return { items }
  })

  server.post(
    '/dsc/admin/requests/:id/reveal',
    { schema: { params: idParams }, preHandler: requireAdmin(deps, 'dsc') },
    async (request, reply) => {
      const result = service.revealById(request.params.id, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: result.row.id,
        ip: request.ip,
        detail: { channel: 'reviewer' },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
    },
  )
}
