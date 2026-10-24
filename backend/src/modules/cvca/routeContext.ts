/**
 * Shared dependency types and validation schemas for the CVCA route handlers.
 */
import { z } from 'zod'

import {
  SUBJECT_NAME_MAX,
  dvClassSchema,
  dvPermissionsSchema,
  isValidSubjectName,
  type DvClass,
} from '@epass42/shared'
import type { dvCert, terminalCert } from '../../db/schema'
import type { AuthContext } from '../auth/middleware'
import type { CvcaService } from './service'
import { parsePermissions } from './dvIssuance'

/** Dependencies for the CVCA routes. */
export interface CvcaRouteDeps extends AuthContext {
  service: CvcaService
}

/** The DV application submission body. */
export const applicationBody = z.object({
  keyMode: z.enum(['remote_generated', 'user_uploaded']).default('remote_generated'),
  subjectCn: z
    .string()
    .min(1)
    .max(SUBJECT_NAME_MAX)
    .refine(isValidSubjectName, { message: 'invalid_subject_name' }),
  /** Optional holder mnemonic (up to 9 chars); derived from the name when absent. */
  holderMnemonic: z
    .string()
    .min(1)
    .max(9)
    .regex(/^[A-Za-z0-9 ]+$/)
    .optional(),
  csrPem: z.string().max(20_000).optional(),
  publicKeyPem: z.string().max(20_000).optional(),
  /** The requested DV trust class (defaults to domestic). */
  dvClass: dvClassSchema,
  /** The requested LDS2 read/write authorization. */
  permissions: dvPermissionsSchema,
  validityDays: z.number().int().min(1).max(92).optional(),
  applicationUrl: z.string().url().max(2000).optional(),
  notes: z.string().max(2000).optional(),
})

/** The public metadata of a DV certificate. */
export function dvMetadata(row: typeof dvCert.$inferSelect) {
  return {
    id: row.id,
    holderReference: row.holderReference,
    authorityReference: row.authorityReference,
    subjectCn: row.subjectCn,
    mnt: row.mnt,
    status: row.status,
    source: row.source,
    keyMode: row.keyMode,
    dvClass: row.dvClass as DvClass,
    permissions: parsePermissions(row.permissionsJson),
    applicationUrl: row.applicationUrl,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    // Only application-issued ("owned") certificates carry an exportable key.
    hasPrivateKey: row.keyRef !== null && row.source === 'owned',
  }
}

/** The public metadata of a terminal (Inspection System) certificate. */
export function terminalMetadata(row: typeof terminalCert.$inferSelect) {
  return {
    id: row.id,
    dvCertId: row.dvCertId,
    holderReference: row.holderReference,
    authorityReference: row.authorityReference,
    subjectCn: row.subjectCn,
    mnt: row.mnt,
    status: row.status,
    source: row.source,
    keyMode: row.keyMode,
    permissions: parsePermissions(row.permissionsJson),
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    hasPrivateKey: row.keyRef !== null && row.source === 'owned',
  }
}
