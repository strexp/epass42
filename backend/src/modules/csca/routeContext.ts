/**
 * Shared dependency types and helpers for the CSCA route handlers.
 */
import { z } from 'zod'

import { parseCertificatePem, sha256 } from '@epass42/pki'
import {
  LDS2_SIGNER_TYPES,
  SIGNER_CERTIFICATE_TYPES,
  documentTypeListSchema,
} from '@epass42/shared'
import type { dscCert } from '../../db/schema'
import { documentTypesOf } from '../../util/cert'
import type { AuthContext } from '../auth/middleware'
import type { CscaService } from './service'

/** Dependencies for the CSCA routes. */
export interface CscaRouteDeps extends AuthContext {
  service: CscaService
}

/**
 * The signer-certificate application submission body.  A DSC application
 * selects one or two DocumentTypes; an LDS2 Signer application selects one or
 * more LDS2 roles instead (Doc 9303-12 §7.1.2).
 */
export const applicationBody = z
  .object({
    keyMode: z.enum(['remote_generated', 'user_uploaded']).default('remote_generated'),
    certificateType: z.enum(SIGNER_CERTIFICATE_TYPES).default('dsc'),
    subjectCn: z.string().min(1).max(64),
    subjectO: z.string().max(64).optional(),
    subjectOu: z.string().max(64).optional(),
    csrPem: z.string().max(20_000).optional(),
    publicKeyPem: z.string().max(20_000).optional(),
    documentTypes: documentTypeListSchema.default(['P']),
    /** LDS2 Signer roles; at least one is required for an LDS2 application. */
    lds2Types: z.array(z.enum(LDS2_SIGNER_TYPES)).max(LDS2_SIGNER_TYPES.length).optional(),
    validityDays: z
      .number()
      .int()
      .min(1)
      .max(20 * 365)
      .optional(),
    issuancePolicy: z.string().max(500).optional(),
    applicationUrl: z.string().url().max(2000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.certificateType === 'lds2') {
      if (!body.lds2Types || body.lds2Types.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['lds2Types'],
          message: 'lds2_type_required',
        })
      } else if (new Set(body.lds2Types).size !== body.lds2Types.length) {
        ctx.addIssue({ code: 'custom', path: ['lds2Types'], message: 'lds2_type_duplicate' })
      }
      // Doc 9303-12 §7.1.2: the commonName is limited to 9 characters.
      if (body.subjectCn.length > 9) {
        ctx.addIssue({ code: 'custom', path: ['subjectCn'], message: 'lds2_cn_too_long' })
      }
    } else if (body.documentTypes.length < 1) {
      ctx.addIssue({ code: 'custom', path: ['documentTypes'], message: 'document_type_required' })
    }
  })

/** The public metadata of a CSCA-issued signer certificate (DSC or LDS2). */
export function certMetadata(row: typeof dscCert.$inferSelect) {
  const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
  const fingerprint = Buffer.from(sha256(der)).toString('hex')
  const documentTypes = row.certificateType === 'dsc' ? documentTypesOf(row.certPem) : []
  return {
    id: row.id,
    serial: row.serial,
    subjectDn: row.subjectDn,
    status: row.status,
    source: row.source,
    mnt: row.mnt,
    keyMode: row.keyMode,
    certificateType: row.certificateType,
    /** LDS2 roles carried in the ExtendedKeyUsage (empty for a DSC). */
    lds2Types: row.certificateType === 'lds2' ? (row.lds2Types ?? []) : [],
    // A DSC may authorize two types; the singular field is only meaningful for
    // a single-type certificate.  Consumers should use `documentTypes`.
    documentType: documentTypes.length === 1 ? documentTypes[0]! : null,
    documentTypes,
    issuancePolicy: row.issuancePolicy,
    applicationUrl: row.applicationUrl,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    revokedAt: row.revokedAt,
    fingerprintSha256: fingerprint,
    // Only application-issued ("owned") certificates carry an exportable key;
    // the system NIA and Master List signers stay internal.
    hasPrivateKey: row.keyRef !== null && row.source === 'owned',
    certPem: row.certPem,
  }
}
