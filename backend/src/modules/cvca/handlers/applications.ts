/**
 * CVCA DV application routes (M17): submission, listing and review.
 *
 * Reviewers may override the applicant's requested LDS2 permissions before
 * approving; the override is recorded on the application and used for issuance.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { dvClassSchema, dvPermissionsSchema } from '@epass42/shared'

import { writeAudit } from '../../../audit/audit'
import { dvApplication, dvCert } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { applicationBody, dvMetadata, type CvcaRouteDeps } from '../routeContext'

/** Registers the DV application submission and review routes. */
export function registerApplicationRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/cvca/applications',
    { schema: { body: applicationBody }, preHandler: requireSession(deps, 'cvca') },
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
        .insert(dvApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          ip: request.ip,
          keyMode: request.body.keyMode,
          subjectCn: request.body.subjectCn,
          holderMnemonic: request.body.holderMnemonic ?? null,
          csrPem: request.body.csrPem ?? null,
          publicKeyPem: request.body.publicKeyPem ?? null,
          dvClass: request.body.dvClass,
          permissionsJson: JSON.stringify(request.body.permissions),
          validityDays: request.body.validityDays ?? null,
          applicationUrl: request.body.applicationUrl ?? null,
          notes: request.body.notes ?? null,
          status: 'submitted',
          createdAt: nowIso(),
        })
        .run()
      const id = Number(result.lastInsertRowid)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'cvca',
        action: 'dv.application.submit',
        targetType: 'dv_application',
        targetId: id,
        ip: request.ip,
      })
      return reply.code(201).send({ id, status: 'submitted' })
    },
  )

  server.get(
    '/cvca/applications',
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
      preHandler: requireSession(deps, 'cvca'),
    },
    async (request) => {
      const principal = request.principal!
      let rows = db.select().from(dvApplication).orderBy(desc(dvApplication.id)).all()
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
    '/cvca/applications/:id',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'cvca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db
        .select()
        .from(dvApplication)
        .where(eq(dvApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!principal.isAdmin && row.applicantAccountId !== principal.account.id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'cvca',
        action: 'dv.application.view',
        targetType: 'dv_application',
        targetId: row.id,
        ip: request.ip,
      })
      // Whether the issued DV's one-time private key is still available.
      const cert =
        row.dvCertId !== null
          ? db.select().from(dvCert).where(eq(dvCert.id, row.dvCertId)).get()
          : undefined
      return { ...row, hasPrivateKey: cert?.keyRef != null }
    },
  )

  server.post(
    '/cvca/applications/:id/approve',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z
          .object({
            permissions: dvPermissionsSchema.optional(),
            dvClass: dvClassSchema.optional(),
          })
          .nullish(),
      },
      preHandler: requireAdmin(deps, 'cvca'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(dvApplication)
        .where(eq(dvApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      const override = {
        permissions: request.body?.permissions,
        dvClass: request.body?.dvClass,
      }
      const cert = await service.approve(row, request.principal!.account.id, override)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'cvca',
        action: 'dv.application.approve',
        targetType: 'dv_application',
        targetId: row.id,
        ip: request.ip,
        detail: override.permissions || override.dvClass ? { override: true } : undefined,
      })
      return reply.code(201).send(dvMetadata(cert))
    },
  )

  server.post(
    '/cvca/applications/:id/reject',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
      preHandler: requireAdmin(deps, 'cvca'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(dvApplication)
        .where(eq(dvApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      service.reject(row, request.principal!.account.id, request.body.reason)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'cvca',
        action: 'dv.application.reject',
        targetType: 'dv_application',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(200).send({ id: row.id, status: 'rejected' })
    },
  )
}
