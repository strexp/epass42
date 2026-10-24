/**
 * CVCA DV application routes (M17): submission, listing and review.
 *
 * Reviewers may override the applicant's requested LDS2 permissions before
 * approving; the override is recorded on the application and used for issuance.
 * The shared workflow owns the route skeleton.
 */
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError, dvClassSchema, dvPermissionsSchema } from '@epass42/shared'

import { dvApplication, dvCert } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { registerApplicationWorkflow } from '../../../certificates/applicationRoutes'
import { resolveValidityDays } from '../../../certificates/policy'
import { applicationBody, dvMetadata, type CvcaRouteDeps } from '../routeContext'

type DvApplicationRow = typeof dvApplication.$inferSelect

interface ApprovalBody {
  permissions?: z.infer<typeof dvPermissionsSchema>
  dvClass?: z.infer<typeof dvClassSchema>
}

/** Registers the DV application submission and review routes. */
export function registerApplicationRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const { db, service, config } = deps

  registerApplicationWorkflow<DvApplicationRow, z.infer<typeof applicationBody>, ApprovalBody>(
    app,
    deps,
    {
      basePath: '/cvca/applications',
      realm: 'cvca',
      targetType: 'dv_application',
      bodySchema: applicationBody,
      approveBodySchema: z
        .object({
          permissions: dvPermissionsSchema.optional(),
          dvClass: dvClassSchema.optional(),
        })
        .nullish(),
      actions: {
        submit: 'dv.application.submit',
        view: 'dv.application.view',
        approve: 'dv.application.approve',
        reject: 'dv.application.reject',
      },
      submit(principal, body, ip) {
        if (!service.canIssueDvs()) {
          throw new AppError('cvca_expired', 'the CVCA certificate has expired', 409)
        }
        if (body.keyMode === 'user_uploaded' && !body.csrPem && !body.publicKeyPem) {
          throw new AppError('csr_or_public_key_required', 'csr or public key required', 400)
        }
        const result = db
          .insert(dvApplication)
          .values({
            mnt: principal.account.activeMnt,
            applicantAccountId: principal.account.id,
            ip,
            keyMode: body.keyMode,
            subjectCn: body.subjectCn.trim(),
            holderMnemonic: body.holderMnemonic ?? null,
            csrPem: body.csrPem ?? null,
            publicKeyPem: body.publicKeyPem ?? null,
            dvClass: body.dvClass,
            permissionsJson: JSON.stringify(body.permissions),
            validityDays: resolveValidityDays('dv', body.validityDays, config.cvca.dv.validityDays),
            applicationUrl: body.applicationUrl ?? null,
            notes: body.notes ?? null,
            status: 'submitted',
            createdAt: nowIso(),
          })
          .run()
        return Number(result.lastInsertRowid)
      },
      find(id) {
        return db.select().from(dvApplication).where(eq(dvApplication.id, id)).get()
      },
      list(principal, query) {
        let rows = db.select().from(dvApplication).orderBy(desc(dvApplication.id)).all()
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
          permissions: (body as ApprovalBody | null | undefined)?.permissions,
          dvClass: (body as ApprovalBody | null | undefined)?.dvClass,
        }
        const cert = await service.approve(row, principal.account.id, override)
        return dvMetadata(cert)
      },
      reject(row, principal, reason) {
        service.reject(row, principal.account.id, reason)
      },
      detail(row) {
        // Whether the issued DV's one-time private key is still available.
        const cert =
          row.dvCertId !== null
            ? db.select().from(dvCert).where(eq(dvCert.id, row.dvCertId)).get()
            : undefined
        return { hasPrivateKey: cert?.keyRef != null, certificate: cert ? dvMetadata(cert) : null }
      },
      approveDetail(body) {
        const override = body as ApprovalBody | null | undefined
        return override?.permissions || override?.dvClass ? { override: true } : undefined
      },
    },
  )
}
