/**
 * Shared dependency types and validation schemas for the DV route handlers.
 *
 * The DV realm is where a Document Verifier holder (or a maintainer) applies
 * for terminal (Inspection System) certificates.  It has no delegation: the
 * signing Document Verifier is resolved from the CVCA state.
 */
import { z } from 'zod'

import { SUBJECT_NAME_MAX, dvPermissionsSchema, isValidSubjectName } from '@epass42/shared'
import type { AuthContext } from '../auth/middleware'
import type { CvcaService } from '../cvca/service'

/** Dependencies for the DV routes. */
export interface DvRouteDeps extends AuthContext {
  service: CvcaService
}

/** The terminal (Inspection System) application submission body. */
export const terminalApplicationBody = z.object({
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
  /** The requested LDS2 read/write authorization. */
  permissions: dvPermissionsSchema,
  validityDays: z.number().int().min(1).max(92).optional(),
  notes: z.string().max(2000).optional(),
})
