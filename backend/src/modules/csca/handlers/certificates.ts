/**
 * CSCA DSC certificate routes (M5): listing, download, one-time key export,
 * revocation and key rollover.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

import { parseCertificatePem } from '@epass42/pki'

import { writeAudit } from '../../../audit/audit'
import { dscCert } from '../../../db/schema'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { sendPrivateKeyOnce } from '../../../certificates/privateKey'
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
      // ML Signers are issued by the CSCA but owned and listed by the ML role.
      const items = rows
        .filter((row) => row.source !== 'ml-signer')
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
      // System-managed signers (NIA, Master List) are internal: their keys are
      // never exported and must not be consumed.
      if (row.source !== 'owned') return reply.code(403).send({ error: 'forbidden' })
      const own = row.mnt !== null && row.mnt === principal.account.activeMnt
      if (!principal.isAdmin && !own) return reply.code(403).send({ error: 'forbidden' })
      return sendPrivateKeyOnce({
        reply,
        db,
        principal,
        row,
        keyRef: row.keyRef,
        keyMode: row.keyMode,
        exportKey: (target) => service.exportDscPrivateKey(target),
        consume: (target) =>
          db
            .update(dscCert)
            .set({ keyRef: null })
            .where(and(eq(dscCert.id, target.id), isNotNull(dscCert.keyRef)))
            .run().changes > 0,
        targetType: 'dsc_cert',
        action: 'dsc.certificate.key',
        targetId: row.id,
        filename: `dsc-${row.id}.key`,
        ip: request.ip,
      })
    },
  )

  server.post(
    '/csca/certificates/:id/revoke',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().max(2000).optional() }).nullish(),
      },
      preHandler: requireSession(deps, 'csca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db.select().from(dscCert).where(eq(dscCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      // System-managed signers (NIA, Master List) are never revoked from here.
      if (row.source !== 'owned') return reply.code(403).send({ error: 'forbidden' })
      const owner = row.mnt !== null && row.mnt === principal.account.activeMnt
      if (!principal.isAdmin && !owner) return reply.code(403).send({ error: 'forbidden' })
      if (row.status !== 'active') return reply.code(409).send({ error: 'certificate_not_active' })
      const cert = service.revoke(row.id, request.body?.reason ?? null)
      if (!cert) return reply.code(404).send({ error: 'certificate_not_found' })
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: 'dsc.certificate.revoke',
        targetType: 'dsc_cert',
        targetId: cert.id,
        ip: request.ip,
        detail: { self: !principal.isAdmin, mnt: row.mnt },
      })
      // Regenerate the CRL of the CSCA key that issued this certificate, so a
      // revocation of a pre-rollover certificate is published under its own
      // issuer (M6/T6.3).
      if (deps.config.crl.autoGenerate) {
        if (cert.cscaKeyId !== null) await service.generateCrlForKey(cert.cscaKeyId)
        else await service.generateCrl()
      }
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
