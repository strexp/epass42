/**
 * CSCA DSC application routes (M5): submission, listing and review.
 *
 * The shared workflow owns the submit/list/view/approve/reject skeleton; this
 * module supplies the signer-specific body, table access and issuance callback.
 */
import type { FastifyInstance } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '@epass42/shared'

import { dscApplication, dscCert } from '../../../db/schema'
import { nowIso } from '../../../util/time'
import { registerApplicationWorkflow } from '../../../certificates/applicationRoutes'
import { resolveValidityDays } from '../../../certificates/policy'
import { applicationBody, certMetadata, type CscaRouteDeps } from '../routeContext'

type DscApplicationRow = typeof dscApplication.$inferSelect

/** Registers the application submission and review routes. */
export function registerApplicationRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const { db, service, config } = deps

  const action = (prefix: 'dsc' | 'lds2') => `${prefix}.application`

  registerApplicationWorkflow<
    DscApplicationRow,
    z.infer<typeof applicationBody>,
    Record<string, never>
  >(app, deps, {
    basePath: '/csca/applications',
    realm: 'csca',
    targetType: 'dsc_application',
    bodySchema: applicationBody,
    approveBodySchema: z.object({}).nullish(),
    actions: {
      submit: (body) => `${action(body.certificateType === 'lds2' ? 'lds2' : 'dsc')}.submit`,
      view: (row) => `${action(row.certificateType === 'lds2' ? 'lds2' : 'dsc')}.view`,
      approve: (row) => `${action(row.certificateType === 'lds2' ? 'lds2' : 'dsc')}.approve`,
      reject: (row) => `${action(row.certificateType === 'lds2' ? 'lds2' : 'dsc')}.reject`,
    },
    submit(principal, body, ip) {
      // The comparison with the expiry is intentionally strict: when the CSCA
      // is unusable, no new DSC/LDS2 application may be accepted.
      if (!service.canIssueCertificates()) {
        throw new AppError('csca_expired', 'the CSCA certificate has expired', 409)
      }
      if (body.keyMode === 'user_uploaded' && !body.csrPem && !body.publicKeyPem) {
        throw new AppError('csr_or_public_key_required', 'csr or public key required', 400)
      }
      const isLds2 = body.certificateType === 'lds2'
      const result = db
        .insert(dscApplication)
        .values({
          mnt: principal.account.activeMnt,
          applicantAccountId: principal.account.id,
          ip,
          keyMode: body.keyMode,
          certificateType: body.certificateType,
          subjectCn: body.subjectCn.trim(),
          // LDS2 Signer subjects hold C and CN only (Doc 9303-12 §7.1.2).
          subjectO: isLds2 ? null : body.subjectO?.trim() || null,
          subjectOu: isLds2 ? null : body.subjectOu?.trim() || null,
          csrPem: body.csrPem ?? null,
          publicKeyPem: body.publicKeyPem ?? null,
          // A DSC carries DocumentTypes; an LDS2 Signer carries its roles.
          documentTypes: isLds2 ? null : body.documentTypes,
          lds2Types: isLds2 ? [...new Set(body.lds2Types ?? [])] : null,
          validityDays: resolveValidityDays(
            isLds2 ? 'lds2' : 'dsc',
            body.validityDays,
            isLds2 ? config.csca.lds2.validityDays : undefined,
          ),
          issuancePolicy: body.issuancePolicy ?? null,
          applicationUrl: body.applicationUrl ?? null,
          notes: body.notes ?? null,
          status: 'submitted',
          createdAt: nowIso(),
        })
        .run()
      return Number(result.lastInsertRowid)
    },
    find(id) {
      return db.select().from(dscApplication).where(eq(dscApplication.id, id)).get()
    },
    list(principal, query) {
      let rows = db.select().from(dscApplication).orderBy(desc(dscApplication.id)).all()
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
    async approve(row, principal) {
      const cert = await service.approve(row, principal.account.id)
      return certMetadata(cert)
    },
    reject(row, principal, reason) {
      service.reject(row, principal.account.id, reason)
    },
    detail(row: DscApplicationRow) {
      // Whether the issued DSC's one-time private key is still available.
      const cert =
        row.dscCertId !== null
          ? db.select().from(dscCert).where(eq(dscCert.id, row.dscCertId)).get()
          : undefined
      return { hasPrivateKey: cert?.keyRef != null, certificate: cert ? certMetadata(cert) : null }
    },
    submitDetail(body) {
      return { certificateType: body.certificateType }
    },
  })
}
