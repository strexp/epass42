/**
 * CSCA DSC application routes (M5): submission, listing and review.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { dscApplication } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { applicationBody, certMetadata, type CscaRouteDeps } from '../routeContext'

/** Registers the application submission and review routes. */
export function registerApplicationRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/csca/applications',
    { schema: { body: applicationBody }, preHandler: requireSession(deps, 'csca') },
    async (request, reply) => {
      const principal = request.principal!
      if (
        request.body.keyMode === 'user_uploaded' &&
        !request.body.csrPem &&
        !request.body.publicKeyPem
      ) {
        return reply.code(400).send({ error: 'csr_or_public_key_required' })
      }
      const result = db
        .insert(dscApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          keyMode: request.body.keyMode,
          subjectCn: request.body.subjectCn,
          csrPem: request.body.csrPem ?? null,
          publicKeyPem: request.body.publicKeyPem ?? null,
          documentType: request.body.documentType,
          validityDays: request.body.validityDays,
          issuancePolicy: request.body.issuancePolicy ?? null,
          applicationUrl: request.body.applicationUrl ?? null,
          notes: request.body.notes ?? null,
          status: 'submitted',
          createdAt: nowIso(),
        })
        .run()
      const id = Number(result.lastInsertRowid)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: 'dsc.application.submit',
        targetType: 'dsc_application',
        targetId: id,
        ip: request.ip,
      })
      return reply.code(201).send({ id, status: 'submitted' })
    },
  )

  server.get(
    '/csca/applications',
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
      preHandler: requireSession(deps, 'csca'),
    },
    async (request) => {
      const principal = request.principal!
      let rows = db.select().from(dscApplication).orderBy(desc(dscApplication.id)).all()
      // Non-admins only see their own applications.
      if (!principal.isAdmin) {
        rows = rows.filter((row) => row.applicantAccountId === principal.account.id)
      }
      rows = rows.filter((row) => !request.query.status || row.status === request.query.status)
      const page = rows.slice(request.query.offset, request.query.offset + request.query.limit)
      return { total: rows.length, items: page, scope: principal.isAdmin ? 'all' : 'own' }
    },
  )

  server.get(
    '/csca/applications/:id',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'csca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db
        .select()
        .from(dscApplication)
        .where(eq(dscApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!principal.isAdmin && row.applicantAccountId !== principal.account.id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      return row
    },
  )

  server.post(
    '/csca/applications/:id/approve',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireAdmin(deps, 'csca'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(dscApplication)
        .where(eq(dscApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      const cert = await service.approve(row, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'csca',
        action: 'dsc.application.approve',
        targetType: 'dsc_application',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(201).send(certMetadata(cert))
    },
  )

  server.post(
    '/csca/applications/:id/reject',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
      preHandler: requireAdmin(deps, 'csca'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(dscApplication)
        .where(eq(dscApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      service.reject(row, request.principal!.account.id, request.body.reason)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'csca',
        action: 'dsc.application.reject',
        targetType: 'dsc_application',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(200).send({ id: row.id, status: 'rejected' })
    },
  )
}
