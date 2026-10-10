/**
 * Shared dependency types and helpers for the CSCA route handlers.
 */
import { z } from 'zod'

import { parseCertificatePem, sha256 } from '@epass42/pki'
import type { dscCert } from '../../db/schema'
import { documentTypesOf } from '../../util/cert'
import type { AuthContext } from '../auth/middleware'
import type { CscaService } from './service'

/** Dependencies for the CSCA routes. */
export interface CscaRouteDeps extends AuthContext {
  service: CscaService
}

/** The DSC application submission body. */
export const applicationBody = z.object({
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

/** The public metadata of a DSC certificate. */
export function certMetadata(row: typeof dscCert.$inferSelect) {
  const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
  const fingerprint = Buffer.from(sha256(der)).toString('hex')
  const documentTypes = documentTypesOf(row.certPem)
  return {
    id: row.id,
    serial: row.serial,
    subjectDn: row.subjectDn,
    status: row.status,
    source: row.source,
    mnt: row.mnt,
    keyMode: row.keyMode,
    documentType: documentTypes[0] ?? null,
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
