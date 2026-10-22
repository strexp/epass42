/**
 * zod schemas shared by the backend and the front end.
 *
 * The DSC signing request accepts only human-friendly structured fields; image
 * data groups are encoded by the browser and submitted as base64.  Raw hex
 * input boxes are deliberately not part of the contract.
 */
import { z } from 'zod'

import { COUNTRY_ALPHA3 } from './constants'
import { documentIssueTypeSchema } from './documentTypes'

/** YYMMDD or YYYYMMDD date, digits only (MRZ / ISO 19794-5). */
export const compactDate = z.string().regex(/^\d{6}(\d{2})?$/, 'expected YYMMDD or YYYYMMDD')

/** Base64-encoded binary payload. */
export const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'invalid base64')

/**
 * MRZ (ICAO Doc 9303-3) fields entered by the applicant.  The concrete document
 * type selects the TD1 (ID/IP) or TD3 (P) layout; `I` is a DSC authorization
 * wildcard and cannot be personalized.
 */
export const mrzFieldsSchema = z.object({
  documentCode: documentIssueTypeSchema.default('P'),
  issuingState: z.string().length(3).default(COUNTRY_ALPHA3),
  surname: z.string().min(1).max(39),
  givenNames: z.string().max(39).default(''),
  documentNumber: z.string().min(1).max(9),
  nationality: z.string().length(3),
  dateOfBirth: compactDate,
  sex: z.enum(['M', 'F', '<']).default('<'),
  /** Optional; computed by the service from the issuing profile validity. */
  dateOfExpiry: compactDate.optional(),
  /** TD3 personal number (ignored by the TD1 layout). */
  personalNumber: z.string().max(14).default(''),
  /** TD3 optional data (ignored by the TD1 layout). */
  optionalData: z.string().max(14).default(''),
  /** TD1 optional data 1 (`<<<` when omitted). */
  optionalData1: z.string().max(15).optional(),
  /** TD1 optional data 2 (`<<<` when omitted). */
  optionalData2: z.string().max(11).optional(),
})

/** DG2 (face) already crop/scale/JPEG-encoded by the browser. */
export const dg2Schema = z.object({
  jpeg: base64,
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
})

/** An already-encoded biometric template (DG3 / DG4) uploaded as a file. */
export const biometricTemplateSchema = z.object({
  /** The full outer DG bytes (`63`/`76`), already wrapped by the client. */
  bytes: base64,
})

/** A display image data group (DG5 `5F40`, DG7 `5F43`). */
export const displayImageSchema = z.object({
  jpeg: base64,
})

/**
 * PACE Card Access Number (CAN): exactly six decimal digits, printed on the
 * document data page (BSI TR-03110-3 A.2.3, ICAO Doc 9303-11). PACE can also
 * use the MRZ password, so the applicant may omit the CAN.
 */
export const canSchema = z.string().regex(/^\d{6}$/, 'expected 6 digits')

/** DG11 additional personal details (subset; expanded in M7). */
export const dg11Schema = z.object({
  fullName: z.string().max(70).optional(),
  otherNames: z.array(z.string().max(70)).max(10).default([]),
  personalNumber: z.string().max(30).optional(),
  fullDateOfBirth: compactDate.optional(),
  placeOfBirth: z.string().max(35).optional(),
  address: z.string().max(70).optional(),
  telephone: z.string().max(35).optional(),
  profession: z.string().max(35).optional(),
  title: z.string().max(35).optional(),
  personalSummary: z.string().max(70).optional(),
  custodyInfo: z.string().max(40).optional(),
})

/** DG12 additional document details (subset; expanded in M7). */
export const dg12Schema = z.object({
  otherPersons: z.array(z.string().max(70)).max(10).default([]),
  taxExit: z.string().max(70).optional(),
})

/** DG16 person to notify (subset; expanded in M7). */
export const dg16Schema = z.object({
  persons: z
    .array(
      z.object({
        name: z.string().max(70),
        telephone: z.string().max(35).optional(),
        address: z.string().max(70).optional(),
        dateRecorded: compactDate.optional(),
      }),
    )
    .max(10)
    .default([]),
})

/**
 * The LDS2 applications whose read/write access a Document Verifier may be
 * authorized for (Doc 9303-12 §7.2.2.4, Certificate Holder Authorization
 * Template; the concrete access bits are defined in Doc 9303-10).
 */
export const LDS2_ROLES = ['travel', 'visa', 'biometrics'] as const
export type Lds2Role = (typeof LDS2_ROLES)[number]

/** Read/write authorization for one LDS2 application. */
export const lds2AccessSchema = z
  .object({
    read: z.boolean().default(false),
    write: z.boolean().default(false),
  })
  .prefault({})

/** LDS1 ePassport CHAT bits for the biometric data groups (BSI TR-03110-4). */
export const epassportAccessSchema = z
  .object({
    /** Read access to DG3 (fingerprint). */
    dg3: z.boolean().default(false),
    /** Read access to DG4 (iris). */
    dg4: z.boolean().default(false),
  })
  .prefault({})

/**
 * The DV / CVCA authorization: the LDS1 ePassport CHAT bits plus read/write
 * access per LDS2 application.  It maps to the four-byte relative authorization
 * `[ePassport, Travel, Visa, Biometrics]` of the CHAT (Doc 9303-10 §5.4,
 * BSI TR-03110-4 §2.1.3.2).
 */
export const dvPermissionsSchema = z
  .object({
    epassport: epassportAccessSchema,
    travel: lds2AccessSchema,
    visa: lds2AccessSchema,
    biometrics: lds2AccessSchema,
  })
  .prefault({})

export type DvPermissions = z.infer<typeof dvPermissionsSchema>

/**
 * Security mechanism and algorithm selections used to build EF.CardAccess /
 * DG14 / DG15.  PACE and Chip Authentication are shared by LDS1 and LDS2 (they
 * live in the master file, Doc 9303-10 §3.11.3/§3.11.4); Active Authentication
 * is LDS1-only.
 */
export const securityOptionsSchema = z.object({
  /** PACE ECDH generic mapping profiles (shared; at least one stays selected). */
  pace: z
    .object({
      ecdhGm3des: z.boolean().default(true),
      ecdhGmAes128: z.boolean().default(true),
    })
    .prefault({}),
  /** Active Authentication (LDS1 only). */
  aa: z
    .object({
      enabled: z.boolean().default(false),
      /**
       * card42's card supports RSA ISO/IEC 9796-2 Scheme 1 with SHA-1 or
       * SHA-256, and ECDSA-SHA-256 (P-256).  The three are mutually exclusive
       * (one AA key per document).
       */
      algorithm: z.enum(['rsaSha1', 'rsaSha256', 'ecdsa']).default('rsaSha1'),
    })
    .prefault({}),
  /**
   * Chip Authentication (shared; forced on when an LDS2 application is emitted).
   * card42 implements the ECDH 3DES and AES-128 profiles; both are advertised
   * (the terminal picks), so there is no algorithm choice here.
   */
  ca: z
    .object({
      enabled: z.boolean().default(false),
      keyId: z.number().int().min(0).max(255).default(1),
    })
    .prefault({}),
  /**
   * Terminal Authentication (Doc 9303-11 §7.1): personalize a CVCA trust point
   * and advertise `id-TA`, so terminals can authenticate to read the LDS1
   * biometric DGs and the LDS2 applications.
   */
  ta: z
    .object({
      enabled: z.boolean().default(false),
      /**
       * The base authorization written to the CVCA trust point (DGI FF07);
       * defaults to the CVCA grant.  Every LDS2 application the document emits
       * always has its read/append bits enabled on top of this, so the value
       * cannot under-authorize an application the card carries.  Its remaining
       * unique effect is the LDS1 ePassport CHAT byte (DG3/DG4), which card42
       * also gates on the trust point.
       */
      authorization: dvPermissionsSchema.optional(),
    })
    .prefault({}),
})

/** Which Document Signer signs the SOD. */
export const dscSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('nia') }),
  z.object({ mode: z.literal('owned'), dscCertId: z.number().int().positive() }),
])

/** The full DSC signing request. */
export const signRequestSchema = z.object({
  mrz: mrzFieldsSchema,
  /** Optional PACE Card Access Number (six digits); omitted uses the MRZ. */
  can: canSchema.optional(),
  dg2: dg2Schema,
  dg3: biometricTemplateSchema.optional(),
  dg4: biometricTemplateSchema.optional(),
  dg5: displayImageSchema.optional(),
  dg7: displayImageSchema.optional(),
  dg11: dg11Schema.optional(),
  dg12: dg12Schema.optional(),
  dg13: z.object({ text: z.string().max(2048) }).optional(),
  dg16: dg16Schema.optional(),
  /** Optional; the DSC service applies the administrator's default. */
  security: securityOptionsSchema.optional(),
  /** Optional; derived from the AS delegation setting. */
  dscSelection: dscSelectionSchema.optional(),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
})

export type MrzFields = z.infer<typeof mrzFieldsSchema>
export type SignRequest = z.infer<typeof signRequestSchema>
export type SecurityOptions = z.infer<typeof securityOptionsSchema>

/**
 * The 4-byte relative authorization of a CHAT: byte 0 is the ePassport CHAT
 * (b1 = DG3, b2 = DG4), bytes 1..3 are the LDS2 applications (b1 = read,
 * b2 = append); b3/b4 are the EF.Certificates read/append bits (Doc 9303-10
 * §5.4.2 Table 96/97).
 */
export function encodeAuthorization(permissions: DvPermissions): Uint8Array {
  const lds2Byte = (access: { read: boolean; write: boolean }): number =>
    (access.read ? 0x05 : 0x00) | (access.write ? 0x0a : 0x00)
  return new Uint8Array([
    (permissions.epassport.dg3 ? 0x01 : 0x00) | (permissions.epassport.dg4 ? 0x02 : 0x00),
    lds2Byte(permissions.travel),
    lds2Byte(permissions.visa),
    lds2Byte(permissions.biometrics),
  ])
}

/** The all-false authorization. */
export function emptyPermissions(): DvPermissions {
  return dvPermissionsSchema.parse({})
}

/**
 * Enables read and append (relative-authorization b1..b4) for the given LDS2
 * applications.
 *
 * The card grants an LDS2 application only when the CVCA trust point authorizes
 * it: card42's `requireLds2Access()` ANDs the trust-point authorization (DGI
 * FF07) with the terminal certificate's application extension.  An application
 * personalized with zero bits therefore fails every LDS2 read with `6982`,
 * whatever the terminal certificate carries (a certificate cannot widen the
 * trust point).  The personalization pipeline calls this for every application
 * it emits so that the trust point and the application agree
 * (Doc 9303-10 §5.4.2, Doc 9303-12 §7.2.2.4).
 */
export function withLds2Access(
  permissions: DvPermissions,
  roles: readonly Lds2Role[],
): DvPermissions {
  if (roles.length === 0) return permissions
  const next: DvPermissions = {
    epassport: { ...permissions.epassport },
    travel: { ...permissions.travel },
    visa: { ...permissions.visa },
    biometrics: { ...permissions.biometrics },
  }
  for (const role of roles) next[role] = { read: true, write: true }
  return next
}

/**
 * The DV trust class encoded in the CHAT role bits (Doc 9303-12 §7.2.2.4,
 * BSI TR-03110): a domestic (trusted) DV uses `80`, a foreign (untrusted) DV
 * uses `40`.
 */
export const DV_CLASSES = ['domestic', 'foreign'] as const
export type DvClass = (typeof DV_CLASSES)[number]
export const dvClassSchema = z.enum(['domestic', 'foreign']).default('domestic')

/** True when at least one access right is granted. */
export function hasAnyPermission(permissions: DvPermissions): boolean {
  return (
    permissions.epassport.dg3 ||
    permissions.epassport.dg4 ||
    LDS2_ROLES.some((role) => permissions[role].read || permissions[role].write)
  )
}
