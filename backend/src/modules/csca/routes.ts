/**
 * CSCA routes (M5, Appendix D):
 *
 *   POST /csca/applications              (session)  submit a DSC application
 *   GET  /csca/applications              (admin)    list/filter
 *   GET  /csca/applications/:id          (session)  applicant or admin
 *   POST /csca/applications/:id/approve  (admin)    issue the DSC
 *   POST /csca/applications/:id/reject   (admin)
 *   POST /csca/certificates/:id/revoke   (admin)
 *   GET  /csca/certificates              (public)   active DSC list
 *   GET  /csca/certificates/:id.pem|der  (public)
 *   POST /csca/keys/rollover             (admin)
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { writeAudit } from '../../audit/audit'
import { parseCertificatePem, sha256 } from '@pkd42/pki'
import { dscApplication, dscCert } from '../../db/schema'
import { nowIso } from '../../util/time'
import { requireAdmin, requireSession, type AuthContext } from '../auth/middleware'
import { CscaService } from './service'

/** Dependencies for the CSCA routes. */
export interface CscaRouteDeps extends AuthContext {
  service: CscaService
  /** Called after a revocation so the CRL can be regenerated (M6). */
  onRevoked?: () => void
}

const applicationBody = z.object({
  keyMode: z.enum(['nia_generated', 'user_uploaded']).default('nia_generated'),
  subjectCn: z.string().min(1).max(64),
  csrPem: z.string().max(20_000).optional(),
  publicKeyPem: z.string().max(20_000).optional(),
  documentType: z.string().min(1).max(2).default('P'),
  validityDays: z
    .number()
    .int()
    .min(1)
    .max(20 * 365)
    .default(3650),
  issuancePolicy: z.string().max(500).optional(),
  applicationUrl: z.string().url().max(2000).optional(),
  notes: z.string().max(2000).optional(),
})

function certMetadata(row: typeof dscCert.$inferSelect) {
  const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
  const fingerprint = Buffer.from(sha256(der)).toString('hex')
  return {
    id: row.id,
    serial: row.serial,
    subjectDn: row.subjectDn,
    status: row.status,
    source: row.source,
    asn: row.asn,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    fingerprintSha256: fingerprint,
    certPem: row.certPem,
  }
}

/** Registers the CSCA routes. */
export function registerCscaRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
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
          asn: principal.account.asn,
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
      preHandler: requireAdmin(deps, 'csca'),
    },
    async (request) => {
      const rows = db
        .select()
        .from(dscApplication)
        .orderBy(desc(dscApplication.id))
        .all()
        .filter((row) => !request.query.status || row.status === request.query.status)
      const page = rows.slice(request.query.offset, request.query.offset + request.query.limit)
      return { total: rows.length, items: page }
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

  server.post(
    '/csca/certificates/:id/revoke',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().max(2000).optional() }),
      },
      preHandler: requireAdmin(deps, 'csca'),
    },
    async (request, reply) => {
      const cert = service.revoke(request.params.id, request.body.reason ?? null)
      if (!cert) return reply.code(404).send({ error: 'certificate_not_found' })
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'csca',
        action: 'dsc.certificate.revoke',
        targetType: 'dsc_cert',
        targetId: cert.id,
        ip: request.ip,
      })
      deps.onRevoked?.()
      return reply.send(certMetadata(cert))
    },
  )

  server.get(
    '/csca/certificates',
    { schema: { querystring: z.object({ includeRevoked: z.coerce.boolean().default(false) }) } },
    async (request) => {
      const rows = db.select().from(dscCert).orderBy(desc(dscCert.id)).all()
      const items = rows
        .filter((row) => request.query.includeRevoked || row.status === 'active')
        .map(certMetadata)
      return { total: items.length, items }
    },
  )

  server.get(
    '/csca/certificates/:id.pem',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const row = db.select().from(dscCert).where(eq(dscCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      return reply.type('application/x-pem-file').send(row.certPem)
    },
  )

  server.get(
    '/csca/certificates/:id.der',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const row = db.select().from(dscCert).where(eq(dscCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
      return reply.type('application/pkix-cert').send(Buffer.from(der))
    },
  )

  server.post(
    '/csca/keys/rollover',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'csca'),
    },
    async (request, reply) => {
      const result = await service.rollover()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'csca',
        action: 'csca.key.rollover',
        targetType: 'csca_key',
        targetId: result.next.id,
        ip: request.ip,
      })
      return reply.send({ previous: result.previous.id, current: result.next.id })
    },
  )
}
