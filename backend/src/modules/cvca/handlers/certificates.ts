/**
 * CVCA certificate routes (M17): DV listing/download, the one-time DV
 * private-key export and CVCA key rollover.
 *
 * Terminal (Inspection System) certificates are not issued here: they are
 * requested and reviewed in the DV realm (`/dv/terminal-applications`).
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { dvCert } from '../../../db/schema'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { dvMetadata, type CvcaRouteDeps } from '../routeContext'

/** Registers the CVCA certificate management routes. */
export function registerCertificateRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get('/cvca/certificates', async () => {
    const items = db.select().from(dvCert).orderBy(desc(dvCert.id)).all().map(dvMetadata)
    return { total: items.length, items }
  })

  server.get(
    '/cvca/certificates/:id.der',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const row = db.select().from(dvCert).where(eq(dvCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      return reply.type('application/octet-stream').send(Buffer.from(row.certDer))
    },
  )

  // One-time download of a system-generated DV private key (owner or CVCA
  // admin).  The sealed key is deleted after the first successful download.
  server.get(
    '/cvca/certificates/:id/private-key',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'cvca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db.select().from(dvCert).where(eq(dvCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      const own = row.mnt !== null && row.mnt === principal.account.activeMnt
      if (!principal.isAdmin && !own) return reply.code(403).send({ error: 'forbidden' })
      if (!row.keyRef) {
        const uploaded = row.keyMode === 'user_uploaded'
        return reply
          .code(uploaded ? 404 : 410)
          .send({ error: uploaded ? 'no_private_key' : 'private_key_consumed' })
      }
      const pem = service.exportDvPrivateKey(row)
      const cleared = db
        .update(dvCert)
        .set({ keyRef: null })
        .where(and(eq(dvCert.id, row.id), isNotNull(dvCert.keyRef)))
        .run()
      if (cleared.changes === 0) {
        return reply.code(410).send({ error: 'private_key_consumed' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'cvca',
        action: 'dv.certificate.key',
        targetType: 'dv_cert',
        targetId: row.id,
        ip: request.ip,
      })
      reply.header('cache-control', 'no-store')
      reply.header('content-disposition', `attachment; filename="dv-${row.id}.key"`)
      return reply.type('application/x-pem-file').send(pem)
    },
  )

  server.post(
    '/cvca/keys/rollover',
    {
      schema: { body: z.object({ confirm: z.literal(true) }) },
      preHandler: requireAdmin(deps, 'cvca'),
    },
    async (request, reply) => {
      const result = await service.rollover()
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'cvca',
        action: 'cvca.key.rollover',
        targetType: 'cvca_key',
        targetId: result.next.id,
        ip: request.ip,
      })
      return reply.send({
        previous: result.previous.id,
        link: result.link.id,
        current: result.next.id,
      })
    },
  )
}
