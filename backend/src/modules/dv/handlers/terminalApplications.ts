/**
 * DV realm terminal (Inspection System) certificate application routes (M18):
 * submission, listing and review.
 *
 * The realm mirrors the CVCA DV application, minus the delegation: the signing
 * Document Verifier is resolved from the maintainer's CVCA delegation, and
 * terminal applications carry no class.  Reviewers may override the requested
 * permissions before approving (still clamped to the signing DV's grant).
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

import { dvPermissionsSchema } from '@epass42/shared'

import { writeAudit } from '../../../audit/audit'
import { terminalApplication, terminalCert } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { terminalMetadata } from '../../cvca/routeContext'
import { terminalApplicationBody, type DvRouteDeps } from '../routeContext'

/** Registers the DV terminal application submission and review routes. */
export function registerTerminalApplicationRoutes(app: FastifyInstance, deps: DvRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/dv/terminal-applications',
    { schema: { body: terminalApplicationBody }, preHandler: requireSession(deps, 'dv') },
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
        .insert(terminalApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          ip: request.ip,
          keyMode: request.body.keyMode,
          subjectCn: request.body.subjectCn,
          holderMnemonic: request.body.holderMnemonic ?? null,
          csrPem: request.body.csrPem ?? null,
          publicKeyPem: request.body.publicKeyPem ?? null,
          permissionsJson: JSON.stringify(request.body.permissions),
          validityDays: request.body.validityDays ?? null,
          notes: request.body.notes ?? null,
          status: 'submitted',
          createdAt: nowIso(),
        })
        .run()
      const id = Number(result.lastInsertRowid)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dv',
        action: 'terminal.application.submit',
        targetType: 'terminal_application',
        targetId: id,
        ip: request.ip,
      })
      return reply.code(201).send({ id, status: 'submitted' })
    },
  )

  server.get(
    '/dv/terminal-applications',
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
      preHandler: requireSession(deps, 'dv'),
    },
    async (request) => {
      const principal = request.principal!
      let rows = db.select().from(terminalApplication).orderBy(desc(terminalApplication.id)).all()
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
    '/dv/terminal-applications/:id',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'dv'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db
        .select()
        .from(terminalApplication)
        .where(eq(terminalApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!principal.isAdmin && row.applicantAccountId !== principal.account.id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dv',
        action: 'terminal.application.view',
        targetType: 'terminal_application',
        targetId: row.id,
        ip: request.ip,
      })
      // Whether the issued terminal's one-time private key is still available.
      const cert =
        row.terminalCertId !== null
          ? db.select().from(terminalCert).where(eq(terminalCert.id, row.terminalCertId)).get()
          : undefined
      return { ...row, hasPrivateKey: cert?.keyRef != null }
    },
  )

  server.get(
    '/dv/terminal-applications/:id/certificate',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'dv'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db
        .select()
        .from(terminalApplication)
        .where(eq(terminalApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!principal.isAdmin && row.applicantAccountId !== principal.account.id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (row.terminalCertId === null) {
        return reply.code(404).send({ error: 'certificate_not_found' })
      }
      const cert = db
        .select()
        .from(terminalCert)
        .where(eq(terminalCert.id, row.terminalCertId))
        .get()
      if (!cert) return reply.code(404).send({ error: 'certificate_not_found' })
      return reply.type('application/octet-stream').send(Buffer.from(cert.certDer))
    },
  )

  // One-time download of a system-generated terminal private key (owner or DV
  // admin).  The sealed key is deleted after the first successful download.
  server.get(
    '/dv/terminal-applications/:id/private-key',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'dv'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db
        .select()
        .from(terminalApplication)
        .where(eq(terminalApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!principal.isAdmin && row.applicantAccountId !== principal.account.id) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (row.terminalCertId === null) {
        return reply.code(404).send({ error: 'certificate_not_found' })
      }
      const cert = db
        .select()
        .from(terminalCert)
        .where(eq(terminalCert.id, row.terminalCertId))
        .get()
      if (!cert) return reply.code(404).send({ error: 'certificate_not_found' })
      if (!cert.keyRef) {
        const uploaded = cert.keyMode === 'user_uploaded'
        return reply
          .code(uploaded ? 404 : 410)
          .send({ error: uploaded ? 'no_private_key' : 'private_key_consumed' })
      }
      const pem = service.exportTerminalPrivateKey(cert)
      const cleared = db
        .update(terminalCert)
        .set({ keyRef: null })
        .where(and(eq(terminalCert.id, cert.id), isNotNull(terminalCert.keyRef)))
        .run()
      if (cleared.changes === 0) {
        return reply.code(410).send({ error: 'private_key_consumed' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dv',
        action: 'terminal.certificate.key',
        targetType: 'terminal_cert',
        targetId: cert.id,
        ip: request.ip,
      })
      reply.header('cache-control', 'no-store')
      reply.header('content-disposition', `attachment; filename="terminal-${cert.id}.key"`)
      return reply.type('application/x-pem-file').send(pem)
    },
  )

  server.post(
    '/dv/terminal-applications/:id/approve',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z
          .object({
            permissions: dvPermissionsSchema.optional(),
          })
          .nullish(),
      },
      preHandler: requireAdmin(deps, 'dv'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(terminalApplication)
        .where(eq(terminalApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      const override = { permissions: request.body?.permissions }
      const cert = await service.approveTerminal(row, request.principal!.account.id, override)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dv',
        action: 'terminal.application.approve',
        targetType: 'terminal_application',
        targetId: row.id,
        ip: request.ip,
        detail: override.permissions ? { override: true } : undefined,
      })
      return reply.code(201).send(terminalMetadata(cert))
    },
  )

  server.post(
    '/dv/terminal-applications/:id/reject',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
      preHandler: requireAdmin(deps, 'dv'),
    },
    async (request, reply) => {
      const row = db
        .select()
        .from(terminalApplication)
        .where(eq(terminalApplication.id, request.params.id))
        .get()
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      service.rejectTerminal(row, request.principal!.account.id, request.body.reason)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dv',
        action: 'terminal.application.reject',
        targetType: 'terminal_application',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(200).send({ id: row.id, status: 'rejected' })
    },
  )
}
