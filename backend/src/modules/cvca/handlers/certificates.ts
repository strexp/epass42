/**
 * CVCA certificate routes (M17): DV listing/download, CVCA key listing and
 * rollover, and the one-time DV private-key export.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { z } from 'zod'

import { dvPermissionsSchema } from '@epass42/shared'
import { cvPublicKeyFromCsr, cvPublicKeyFromSpki, pemToDer } from '@epass42/pki'

import { writeAudit } from '../../../audit/audit'
import { dvCert, terminalCert } from '../../../db/schema'
import { requireAdmin, requireSession } from '../../auth/middleware'
import { holderMnemonicOf } from '../dvIssuance'
import { dvMetadata, terminalMetadata, type CvcaRouteDeps } from '../routeContext'

/** Registers the CVCA certificate management routes. */
export function registerCertificateRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  /** Terminal application body (shared by both issuance entry points). */
  const terminalBody = z.object({
    keyMode: z.enum(['remote_generated', 'user_uploaded']).default('remote_generated'),
    subjectCn: z.string().min(1).max(64),
    holderMnemonic: z
      .string()
      .min(1)
      .max(9)
      .regex(/^[A-Za-z0-9 ]+$/)
      .optional(),
    csrPem: z.string().max(20_000).optional(),
    publicKeyPem: z.string().max(20_000).optional(),
    permissions: dvPermissionsSchema.optional(),
    validityDays: z.number().int().min(1).max(92).optional(),
  })

  /**
   * Issues a terminal certificate under a DV, validating the key material and
   * recording the audit entry.  `mnt` is the terminal holder's maintainer (the
   * DV's own, or the applicant's when signing with the CVCA default DV).
   */
  async function issueTerminalUnder(
    dv: typeof dvCert.$inferSelect,
    body: z.infer<typeof terminalBody>,
    actorId: number,
    mnt: string | null,
    ip: string,
    reply: FastifyReply,
  ) {
    if (!dv.keyRef) return reply.code(409).send({ error: 'dv_key_unavailable' })
    if (body.keyMode === 'user_uploaded' && !body.csrPem && !body.publicKeyPem) {
      return reply.code(400).send({ error: 'csr_or_public_key_required' })
    }
    const publicKey =
      body.keyMode === 'user_uploaded'
        ? body.csrPem
          ? cvPublicKeyFromCsr(pemToDer(body.csrPem))
          : cvPublicKeyFromSpki(pemToDer(body.publicKeyPem!))
        : undefined
    const cert = await service.issueTerminal(dv, {
      subjectCn: body.subjectCn,
      holderMnemonic: holderMnemonicOf({
        holderMnemonic: body.holderMnemonic ?? null,
        subjectCn: body.subjectCn,
        mnt,
      }),
      permissions: body.permissions,
      validityDays: body.validityDays ?? deps.config.cvca.dv.validityDays,
      mnt,
      keyMode: body.keyMode,
      publicKey,
    })
    writeAudit(db, {
      actorAccountId: actorId,
      realm: 'cvca',
      action: 'terminal.certificate.issue',
      targetType: 'terminal_cert',
      targetId: cert.id,
      ip,
    })
    return reply.code(201).send(terminalMetadata(cert))
  }

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

  /* Terminals (Inspection System) -------------------------------------- */

  server.get(
    '/cvca/certificates/:id/terminals',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const dv = db.select().from(dvCert).where(eq(dvCert.id, request.params.id)).get()
      if (!dv) return reply.code(404).send({ error: 'certificate_not_found' })
      const items = db
        .select()
        .from(terminalCert)
        .where(eq(terminalCert.dvCertId, dv.id))
        .orderBy(desc(terminalCert.id))
        .all()
        .map(terminalMetadata)
      return { total: items.length, items }
    },
  )

  server.post(
    '/cvca/certificates/:id/terminals',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: terminalBody,
      },
      preHandler: requireSession(deps, 'cvca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const dv = db.select().from(dvCert).where(eq(dvCert.id, request.params.id)).get()
      if (!dv) return reply.code(404).send({ error: 'certificate_not_found' })
      const own = dv.mnt !== null && dv.mnt === principal.account.activeMnt
      if (!principal.isAdmin && !own) return reply.code(403).send({ error: 'forbidden' })
      return issueTerminalUnder(dv, request.body, principal.account.id, dv.mnt, request.ip, reply)
    },
  )

  // Delegation-aware issuance: signs with the maintainer's own active DV, or
  // the CVCA default DV, following the DV delegation setting.  This is the
  // entry point the Terminal certificate application system will use.
  server.post(
    '/cvca/terminals',
    { schema: { body: terminalBody }, preHandler: requireSession(deps, 'cvca') },
    async (request, reply) => {
      const principal = request.principal!
      const dv = service.resolveDvSelection(principal.account.activeMnt)
      if (!dv) return reply.code(409).send({ error: 'no_dv_available' })
      return issueTerminalUnder(
        dv,
        request.body,
        principal.account.id,
        principal.account.activeMnt,
        request.ip,
        reply,
      )
    },
  )

  server.get(
    '/cvca/terminals/:id.der',
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (request, reply) => {
      const row = db.select().from(terminalCert).where(eq(terminalCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      return reply.type('application/octet-stream').send(Buffer.from(row.certDer))
    },
  )

  server.get(
    '/cvca/terminals/:id/private-key',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireSession(deps, 'cvca'),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = db.select().from(terminalCert).where(eq(terminalCert.id, request.params.id)).get()
      if (!row) return reply.code(404).send({ error: 'certificate_not_found' })
      const own = row.mnt !== null && row.mnt === principal.account.activeMnt
      if (!principal.isAdmin && !own) return reply.code(403).send({ error: 'forbidden' })
      if (!row.keyRef) {
        const uploaded = row.keyMode === 'user_uploaded'
        return reply
          .code(uploaded ? 404 : 410)
          .send({ error: uploaded ? 'no_private_key' : 'private_key_consumed' })
      }
      const pem = service.exportTerminalPrivateKey(row)
      const cleared = db
        .update(terminalCert)
        .set({ keyRef: null })
        .where(and(eq(terminalCert.id, row.id), isNotNull(terminalCert.keyRef)))
        .run()
      if (cleared.changes === 0) {
        return reply.code(410).send({ error: 'private_key_consumed' })
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'cvca',
        action: 'terminal.certificate.key',
        targetType: 'terminal_cert',
        targetId: row.id,
        ip: request.ip,
      })
      reply.header('cache-control', 'no-store')
      reply.header('content-disposition', `attachment; filename="terminal-${row.id}.key"`)
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
