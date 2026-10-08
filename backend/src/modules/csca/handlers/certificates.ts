/**
 * CSCA DSC certificate routes (M5): listing, download, one-time key export,
 * revocation and key rollover.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

import { parseCertificatePem } from '@pkd42/pki'

import { writeAudit } from '../../../audit/audit'
import { dscCert } from '../../../db/schema'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { certMetadata, type CscaRouteDeps } from '../routeContext'

/** Registers the certificate management routes. */
export function registerCertificateRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

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

  // One-time download of a system-generated DSC private key (owner AS or CSCA
  // admin).  The sealed key is deleted after the first successful download.
  server.get(
    '/csca/certificates/:id/private-key',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'csca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db.select().from(dscCert).where(eq(dscCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      const own = row.asn !== null && row.asn === principal.account.asn
      if (!principal.isAdmin && !own) return reply.code(403).send({ error: 'forbidden' })
      if (!row.keyRef) {
        const uploaded = row.keyMode === 'user_uploaded'
        return reply
          .code(uploaded ? 404 : 410)
          .send({ error: uploaded ? 'no_private_key' : 'private_key_consumed' })
      }
      // Export, then atomically clear the sealed key so it can be taken once.
      const pem = service.exportDscPrivateKey(row)
      const cleared = db
        .update(dscCert)
        .set({ keyRef: null })
        .where(and(eq(dscCert.id, row.id), isNotNull(dscCert.keyRef)))
        .run()
      if (cleared.changes === 0) {
        return reply.code(410).send({ error: 'private_key_consumed' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: 'dsc.certificate.key',
        targetType: 'dsc_cert',
        targetId: row.id,
        ip: request.ip,
      })
      reply.header('cache-control', 'no-store')
      reply.header('content-disposition', `attachment; filename="dsc-${row.id}.key"`)
      return reply.type('application/x-pem-file').send(pem)
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
      // Regenerate the CRL so the revocation is published promptly (M6/T6.3).
      if (deps.config.crl.autoGenerate) await service.generateCrl()
      return reply.send(certMetadata(cert))
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
