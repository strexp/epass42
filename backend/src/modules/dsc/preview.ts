/**
 * Masking and non-destructive preview (M8/T8.1.3).
 *
 * The preview is rebuilt from the structured request (never from the artifact)
 * and masks the sensitive fields configured for the deployment.  Images are
 * reported by presence, never returned as bytes.
 */
import type { SecurityOptions, SignRequest } from '@epass42/shared'
import { dataGroupList } from './dataGroups'
import { DEFAULT_SECURITY, mergeSecurity, toSecurityOverlay } from './securityOptions'

/** The preview mask rules. */
export interface MaskRules {
  /** How many leading characters of a value to keep. */
  keepLead: number
  /** How many trailing characters of a value to keep. */
  keepTail: number
}

/** Default mask rules (T8.1.3). */
export const DEFAULT_MASK: MaskRules = { keepLead: 2, keepTail: 2 }

/** Masks a value, keeping a few characters for recognisability. */
export function maskValue(value: string, rules: MaskRules = DEFAULT_MASK): string {
  if (value.length <= rules.keepLead + rules.keepTail) return '*'.repeat(value.length)
  return (
    value.slice(0, rules.keepLead) +
    '*'.repeat(value.length - rules.keepLead - rules.keepTail) +
    value.slice(value.length - rules.keepTail)
  )
}

/** Masks a compact date to its year only. */
export function maskDate(value: string): string {
  return value.length >= 6 ? value.slice(0, 2) + '****' : '******'
}

/** A masked field: presence plus the masked value. */
function field(value: string | undefined, mask = true): { present: boolean; value?: string } {
  if (!value) return { present: false }
  return { present: true, value: mask ? maskValue(value) : value }
}

/** The non-destructive preview of a signing request. */
export interface RequestPreview {
  documentCode: string
  issuingState: string
  documentNumber: ReturnType<typeof field>
  surname: ReturnType<typeof field>
  givenNames: ReturnType<typeof field>
  dateOfBirth: ReturnType<typeof field>
  dateOfExpiry: ReturnType<typeof field>
  nationality: string
  sex: string
  dataGroups: number[]
  images: { dg2: boolean; dg5: boolean; dg7: boolean }
  biometrics: { dg3: boolean; dg4: boolean }
  security: SecurityOptions
  /** Masked optional fields. */
  additional: {
    dg11: boolean
    dg12: boolean
    dg13: boolean
    dg16: boolean
  }
}

/** Builds the masked preview from a request payload. */
export function buildPreview(
  payload: SignRequest,
  rules: MaskRules = DEFAULT_MASK,
  security: SignRequest['security'] = payload.security,
): RequestPreview {
  const mask = (value: string | undefined): ReturnType<typeof field> => field(value, true)
  void rules
  const resolved = mergeSecurity(DEFAULT_SECURITY, toSecurityOverlay(security))
  return {
    documentCode: payload.mrz.documentCode,
    issuingState: payload.mrz.issuingState,
    documentNumber: mask(payload.mrz.documentNumber),
    surname: mask(payload.mrz.surname),
    givenNames: mask(payload.mrz.givenNames),
    dateOfBirth: { present: true, value: maskDate(payload.mrz.dateOfBirth) },
    dateOfExpiry: { present: true, value: maskDate(payload.mrz.dateOfExpiry ?? '') },
    nationality: payload.mrz.nationality,
    sex: payload.mrz.sex,
    dataGroups: dataGroupList(payload, resolved),
    images: { dg2: true, dg5: Boolean(payload.dg5), dg7: Boolean(payload.dg7) },
    biometrics: { dg3: Boolean(payload.dg3), dg4: Boolean(payload.dg4) },
    security: resolved,
    additional: {
      dg11: Boolean(payload.dg11),
      dg12: true,
      dg13: Boolean(payload.dg13),
      dg16: Boolean(payload.dg16 && payload.dg16.persons.length > 0),
    },
  }
}
