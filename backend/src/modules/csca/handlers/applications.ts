/**
 * CSCA DSC application routes (M5): submission, listing and review.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { dscApplication, dscCert } from '../../../db/schema'
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
      // The comparison with the expiry is intentionally strict: when the CSCA
      // is expired no new DSC/LDS2 application may be accepted.
      if (!deps.service.canIssueCertificates()) {
        return reply.code(409).send({ error: 'csca_expired' })
      }
      if (
        request.body.keyMode === 'user_uploaded' &&
        !request.body.csrPem &&
        !request.body.publicKeyPem
      ) {
        return reply.code(400).send({ error: 'csr_or_public_key_required' })
      }
      const isLds2 = request.body.certificateType === 'lds2'
      const result = db
        .insert(dscApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          ip: request.ip,
          keyMode: request.body.keyMode,
          certificateType: request.body.certificateType,
          subjectCn: request.body.subjectCn.trim(),
          // LDS2 Signer subjects hold C and CN only (Doc 9303-12 §7.1.2).
          subjectO: isLds2 ? null : request.body.subjectO?.trim() || null,
          subjectOu: isLds2 ? null : request.body.subjectOu?.trim() || null,
          csrPem: request.body.csrPem ?? null,
          publicKeyPem: request.body.publicKeyPem ?? null,
          // A DSC carries DocumentTypes; an LDS2 Signer carries its roles.
          documentTypes: isLds2 ? null : request.body.documentTypes,
          lds2Types: isLds2 ? [...new Set(request.body.lds2Types ?? [])] : null,
          validityDays:
            request.body.validityDays ?? (isLds2 ? deps.config.csca.lds2.validityDays : 3650),
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
        action: isLds2 ? 'lds2.application.submit' : 'dsc.application.submit',
        targetType: 'dsc_application',
        targetId: id,
        ip: request.ip,
        detail: { certificateType: request.body.certificateType },
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
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: row.certificateType === 'lds2' ? 'lds2.application.view' : 'dsc.application.view',
        targetType: 'dsc_application',
        targetId: row.id,
        ip: request.ip,
      })
      // Whether the issued DSC's one-time private key is still available.
      const cert =
        row.dscCertId !== null
          ? db.select().from(dscCert).where(eq(dscCert.id, row.dscCertId)).get()
          : undefined
      return { ...row, hasPrivateKey: cert?.keyRef != null }
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
        action:
          row.certificateType === 'lds2' ? 'lds2.application.approve' : 'dsc.application.approve',
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
        action:
          row.certificateType === 'lds2' ? 'lds2.application.reject' : 'dsc.application.reject',
        targetType: 'dsc_application',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(200).send({ id: row.id, status: 'rejected' })
    },
  )
}
