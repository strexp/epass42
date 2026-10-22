/**
 * Labels for the certificate types the CSCA issues: a Document Signer (DSC) or
 * an LDS2 Signer authorizing one or more LDS2 roles (Doc 9303-12 §7.1.2).
 */
import type { Lds2SignerType, SignerCertificateType } from '@epass42/shared'

export interface Lds2SignerTypeOption {
  labelKey: string
  value: Lds2SignerType
}

/** The LDS2 signer roles in OID order (TS, V, B). */
export const lds2SignerTypeValues: readonly Lds2SignerTypeOption[] = [
  { labelKey: 'common.lds2Types.ts', value: 'ts' },
  { labelKey: 'common.lds2Types.v', value: 'v' },
  { labelKey: 'common.lds2Types.b', value: 'b' },
]

/** Descriptive labels, e.g. in the role picker: "LDS2-TS (travel stamp)". */
const LABEL_KEYS: Record<Lds2SignerType, string> = {
  ts: 'common.lds2Types.ts',
  v: 'common.lds2Types.v',
  b: 'common.lds2Types.b',
}

/** Compact labels for table cells: "LDS2-TS" without the description. */
const CODE_KEYS: Record<Lds2SignerType, string> = {
  ts: 'common.lds2TypeCodes.ts',
  v: 'common.lds2TypeCodes.v',
  b: 'common.lds2TypeCodes.b',
}

/** Formats one LDS2 signer role (e.g. "LDS2-TS (travel stamp)"). */
export function lds2SignerTypeLabel(type: Lds2SignerType, t: (key: string) => string): string {
  return t(LABEL_KEYS[type])
}

/** Formats the LDS2 roles of a certificate in catalog order. */
export function lds2SignerTypesLabel(
  types: readonly Lds2SignerType[],
  t: (key: string) => string,
): string {
  if (types.length === 0) return t('common.lds2')
  return lds2SignerTypeValues
    .filter((option) => types.includes(option.value))
    .map((option) => t(option.labelKey))
    .join(t('common.documentType.separator'))
}

/** Formats the LDS2 roles of a certificate as compact codes in catalog order. */
export function lds2SignerTypeCodesLabel(
  types: readonly Lds2SignerType[],
  t: (key: string) => string,
): string {
  if (types.length === 0) return t('common.lds2')
  return lds2SignerTypeValues
    .filter((option) => types.includes(option.value))
    .map((option) => t(CODE_KEYS[option.value]))
    .join(t('common.documentType.separator'))
}

/** Formats a certificate's type for a table: "DSC" or its LDS2 role codes. */
export function signerCertificateLabel(
  certificateType: SignerCertificateType | null | undefined,
  lds2Types: readonly Lds2SignerType[] | null | undefined,
  t: (key: string) => string,
): string {
  if (certificateType === 'lds2') return lds2SignerTypeCodesLabel(lds2Types ?? [], t)
  return t('common.dsc')
}
