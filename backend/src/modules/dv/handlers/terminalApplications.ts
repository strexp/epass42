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

import { AppError, dvPermissionsSchema } from '@epass42/shared'

import { terminalApplication, terminalCert } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { registerApplicationWorkflow } from '../../../certificates/applicationRoutes'
import { resolveValidityDays } from '../../../certificates/policy'
import { sendPrivateKeyOnce } from '../../../certificates/privateKey'
import { lifecycleCertificate } from '../../../certificates/status'
import { requireSession } from '../../auth/middleware'
import { terminalMetadata } from '../../cvca/routeContext'
import { currentCvcaKey } from '../../cvca/service'
import { terminalApplicationBody, type DvRouteDeps } from '../routeContext'

type TerminalApplicationRow = typeof terminalApplication.$inferSelect

/** Registers the DV terminal application submission and review routes. */
export function registerTerminalApplicationRoutes(app: FastifyInstance, deps: DvRouteDeps): void {
  const { db, service, config } = deps

  registerApplicationWorkflow<
    TerminalApplicationRow,
    z.infer<typeof terminalApplicationBody>,
    { permissions?: z.infer<typeof dvPermissionsSchema> }
  >(app, deps, {
    basePath: '/dv/terminal-applications',
    realm: 'dv',
    targetType: 'terminal_application',
    bodySchema: terminalApplicationBody,
    approveBodySchema: z
      .object({
        permissions: dvPermissionsSchema.optional(),
      })
      .nullish(),
    actions: {
      submit: 'terminal.application.submit',
      view: 'terminal.application.view',
      approve: 'terminal.application.approve',
      reject: 'terminal.application.reject',
    },
    submit(principal, body, ip) {
      // Strict lifecycle gate: no new IS application while the NIA DV is
      // expired or missing.
      if (!service.canIssueTerminals()) {
        throw new AppError('nia_dv_expired', 'the NIA DV has expired', 409)
      }
      if (body.keyMode === 'user_uploaded' && !body.csrPem && !body.publicKeyPem) {
        throw new AppError('csr_or_public_key_required', 'csr or public key required', 400)
      }
      const result = db
        .insert(terminalApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          ip,
          keyMode: body.keyMode,
          subjectCn: body.subjectCn.trim(),
          holderMnemonic: body.holderMnemonic ?? null,
          csrPem: body.csrPem ?? null,
          publicKeyPem: body.publicKeyPem ?? null,
          permissionsJson: JSON.stringify(body.permissions),
          validityDays: resolveValidityDays(
            'terminal',
            body.validityDays,
            config.cvca.dv.validityDays,
          ),
          notes: body.notes ?? null,
          status: 'submitted',
          createdAt: nowIso(),
        })
        .run()
      return Number(result.lastInsertRowid)
    },
    find(id) {
      return db.select().from(terminalApplication).where(eq(terminalApplication.id, id)).get()
    },
    list(principal, query) {
      let rows = db.select().from(terminalApplication).orderBy(desc(terminalApplication.id)).all()
      // Non-admins only see their own applications.
      if (!principal.isAdmin) {
        rows = rows.filter((row) => row.applicantAccountId === principal.account.id)
      }
      rows = rows.filter((row) => !query.status || row.status === query.status)
      return {
        total: rows.length,
        items: rows.slice(query.offset, query.offset + query.limit),
        scope: principal.isAdmin ? 'all' : 'own',
      }
    },
    async approve(row, principal, body) {
      const override = {
        permissions: (body as { permissions?: z.infer<typeof dvPermissionsSchema> } | null)
          ?.permissions,
      }
      const cert = await service.approveTerminal(row, principal.account.id, override)
      return terminalMetadata(cert)
    },
    reject(row, principal, reason) {
      service.rejectTerminal(row, principal.account.id, reason)
    },
    approveDetail(body) {
      return body?.permissions ? { override: true } : undefined
    },
    detail(row) {
      const cert =
        row.terminalCertId !== null
          ? db.select().from(terminalCert).where(eq(terminalCert.id, row.terminalCertId)).get()
          : undefined
      const dv = service.resolveDvSelection(row.mnt)
      const cvca = currentCvcaKey(db)
      return {
        hasPrivateKey: cert?.keyRef != null,
        signingDv: dv
          ? {
              source: dv.source,
              ...lifecycleCertificate(dv, {
                format: 'cv',
                parentNotAfter: cvca?.notAfter,
              }),
            }
          : null,
        terminal: cert ? terminalMetadata(cert) : null,
      }
    },
  })

  const server = app.withTypeProvider<ZodTypeProvider>()

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
      return sendPrivateKeyOnce({
        reply,
        db,
        principal,
        row: cert,
        keyRef: cert.keyRef,
        keyMode: cert.keyMode,
        exportKey: (target) => service.exportTerminalPrivateKey(target),
        consume: (target) =>
          db
            .update(terminalCert)
            .set({ keyRef: null })
            .where(and(eq(terminalCert.id, target.id), isNotNull(terminalCert.keyRef)))
            .run().changes > 0,
        targetType: 'terminal_cert',
        action: 'terminal.certificate.key',
        targetId: cert.id,
        filename: `terminal-${cert.id}.key`,
        ip: request.ip,
      })
    },
  )
}
