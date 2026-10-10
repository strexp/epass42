/**
 * DSC review routes (M7): the reviewer detail view, approve/reject/regenerate
 * and the mode-B queue.  Requests are addressed by their public reference.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { canReview } from '../../auth/authorization'
import { requireAdmin } from '../../auth/middleware'
import type { IssuingDefaults } from '../build'
import { scopeOf, referenceParams, type DscRouteDeps } from '../routeContext'

/** Registers the review routes. */
export function registerReviewRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  // Reviewer detail view: the unmasked structured submission, for judging a
  // request.  Only the owner's reviewers (delegated MNT or NIA admin) may read
  // it; the access is audited.
  server.get(
    '/dsc/requests/:reference/review',
    { schema: { params: referenceParams } },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!scope || !principal) return reply.code(401).send({ error: 'unauthorized' })
      if (!canReview(scope, { mnt: row.mnt, dscSelection: row.dscSelection })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.request.view',
        targetType: 'sign_request',
        targetId: row.reference,
        ip: request.ip,
      })
      return reply.send({ ...service.metadata(row), payload: service.full(row) })
    },
  )

  server.post(
    '/dsc/requests/:reference/approve',
    {
      schema: {
        params: referenceParams,
        body: z
          .object({
            deliveryMode: z.enum(['applicant', 'reviewer']).optional(),
            profileOverrides: z.record(z.string(), z.string()).optional(),
          })
          .default({}),
      },
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
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
        targetId: row.reference,
        ip: request.ip,
      })

      // Email notification with a two-step (non-consuming) landing link.
      if (updated.email && deps.mailer) {
        const confirmToken = service.createRevealToken(updated.reference, 'confirm', 7 * 86_400)
        service.createMailToken(updated.reference, 'approved', 7 * 86_400)
        const link = `${deps.config.publicUrl.replace(/\/$/, '')}/dsc/reveal/${confirmToken}`
        await deps.mailer
          .send({
            to: updated.email,
            subject: 'ePass 42: your signing request was approved',
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
          targetId: row.reference,
          ip: request.ip,
        })
      }
      return reply.send(service.metadata(updated))
    },
  )

  server.post(
    '/dsc/requests/:reference/reject',
    {
      schema: {
        params: referenceParams,
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
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
        targetId: row.reference,
        ip: request.ip,
      })
      return reply.send({ reference: row.reference, status: 'rejected' })
    },
  )

  server.post(
    '/dsc/requests/:reference/regenerate',
    {
      schema: { params: referenceParams, body: z.object({}).default({}) },
      preHandler: requireAdmin(deps, 'dsc'),
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      if (row.status !== 'approved') return reply.code(409).send({ error: 'request_not_approved' })
      const updated = await service.regenerate(row, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.regenerate',
        targetType: 'sign_request',
        targetId: row.reference,
        ip: request.ip,
      })
      return reply.send(service.metadata(updated))
    },
  )

  server.get('/dsc/admin/requests', { preHandler: requireAdmin(deps, 'dsc') }, async () => {
    const items = service.adminQueue().map((row) => service.metadata(row))
    return { items }
  })

  server.post(
    '/dsc/admin/requests/:reference/reveal',
    { schema: { params: referenceParams }, preHandler: requireAdmin(deps, 'dsc') },
    async (request, reply) => {
      const result = service.revealForReviewer(
        request.params.reference,
        request.principal!.account.id,
      )
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: result.row.reference,
        ip: request.ip,
        detail: { channel: 'reviewer' },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
    },
  )
}
