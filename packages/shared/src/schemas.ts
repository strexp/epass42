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
  dateOfExpiry: compactDate,
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
  issuingAuthority: z.string().max(35).optional(),
  dateOfIssue: compactDate.optional(),
  otherPersons: z.array(z.string().max(70)).max(10).default([]),
  endorsements: z.string().max(70).optional(),
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

/** Security mechanism switches used to build EF.CardAccess / DG14 / DG15. */
export const securityOptionsSchema = z
  .object({
    paceEcdhGm3des: z.boolean().default(true),
    paceEcdhGmAes128: z.boolean().default(true),
    caEcdh3des: z.boolean().default(false),
    caEcdhAes128: z.boolean().default(false),
    caKeyId: z.number().int().min(0).max(255).default(1),
    aa: z.boolean().default(false),
  })
  .default({
    paceEcdhGm3des: true,
    paceEcdhGmAes128: true,
    caEcdh3des: false,
    caEcdhAes128: false,
    caKeyId: 1,
    aa: false,
  })

/** Which Document Signer signs the SOD. */
export const dscSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('nia') }),
  z.object({ mode: z.literal('owned'), dscCertId: z.number().int().positive() }),
])

/** The full DSC signing request. */
export const signRequestSchema = z.object({
  mrz: mrzFieldsSchema,
  dg2: dg2Schema,
  dg3: biometricTemplateSchema.optional(),
  dg4: biometricTemplateSchema.optional(),
  dg5: displayImageSchema.optional(),
  dg7: displayImageSchema.optional(),
  dg11: dg11Schema.optional(),
  dg12: dg12Schema.optional(),
  dg13: z.object({ text: z.string().max(2048) }).optional(),
  dg16: dg16Schema.optional(),
  security: securityOptionsSchema,
  dscSelection: dscSelectionSchema.default({ mode: 'nia' }),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
})

export type MrzFields = z.infer<typeof mrzFieldsSchema>
export type SignRequest = z.infer<typeof signRequestSchema>
export type SecurityOptions = z.infer<typeof securityOptionsSchema>
export type DscSelection = z.infer<typeof dscSelectionSchema>

/** dn42 OAuth claims we consume. */
export const dn42ClaimsSchema = z.object({
  sub: z.string(),
  iss: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  dn42: z
    .object({
      asn: z.number().int().optional(),
      active_mnt: z.string().optional(),
      active_name: z.string().optional(),
      mnt_by: z.array(z.string()).optional(),
      route: z.array(z.string()).optional(),
      route6: z.array(z.string()).optional(),
      timestamp: z.number().optional(),
    })
    .optional(),
})

export type Dn42Claims = z.infer<typeof dn42ClaimsSchema>
