/**
 * zod schemas shared by the backend and the front end.
 *
 * The DSC signing request accepts only human-friendly structured fields; image
 * data groups are encoded by the browser and submitted as base64.  Raw hex
 * input boxes are deliberately not part of the contract.
 */
import { z } from 'zod'

import { COUNTRY_ALPHA3 } from './constants'

/** YYMMDD or YYYYMMDD date, digits only (MRZ / ISO 19794-5). */
export const compactDate = z.string().regex(/^\d{6}(\d{2})?$/, 'expected YYMMDD or YYYYMMDD')

/** Base64-encoded binary payload. */
export const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'invalid base64')

/** MRZ (ICAO Doc 9303-3) TD3 fields entered by the applicant. */
export const mrzFieldsSchema = z.object({
  documentCode: z.string().min(1).max(2).default('P'),
  issuingState: z.literal(COUNTRY_ALPHA3).default(COUNTRY_ALPHA3),
  surname: z.string().min(1).max(39),
  givenNames: z.string().max(39).default(''),
  documentNumber: z.string().min(1).max(9),
  nationality: z.string().length(3),
  dateOfBirth: compactDate,
  sex: z.enum(['M', 'F', '<']).default('<'),
  /** Optional; computed by the service from the issuing profile validity. */
  dateOfExpiry: compactDate.optional(),
  personalNumber: z.string().max(14).default(''),
  optionalData: z.string().max(14).default(''),
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
      /** card42's card signs with ISO/IEC 9796-2 + SHA-1. */
      algorithm: z.enum(['rsaSha1']).default('rsaSha1'),
    })
    .prefault({}),
  /** Chip Authentication (shared; forced on when an LDS2 application is emitted). */
  ca: z
    .object({
      enabled: z.boolean().default(false),
      /** card42 currently implements only the ECDH 3DES profile. */
      algorithm: z.enum(['ecdh3des']).default('ecdh3des'),
      keyId: z.number().int().min(0).max(255).default(1),
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
