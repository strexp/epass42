/**
 * The document types offered by the personalization and PKD forms.
 *
 * `documentTypeValues` lists the concrete document types that can be
 * personalized (`P` TD3 passport, `ID`/`IP` TD1 cards).  The DSC application
 * form additionally offers `I`, the Doc 9303-12 wildcard that authorizes every
 * `I*` document type.  Labels come from i18n so they follow the locale.
 */
import { DOCUMENT_TYPES } from '@epass42/shared'
import type { DocumentIssueType, DocumentTypeCode } from '@epass42/shared'

export interface DocumentTypeOption<T extends DocumentTypeCode> {
  labelKey: string
  value: T
}

/** Concrete document types accepted by the signing service and PKD lookup. */
export const documentTypeValues: readonly DocumentTypeOption<DocumentIssueType>[] = [
  { labelKey: 'common.documentType.passport', value: 'P' },
  { labelKey: 'common.documentType.identityCard', value: 'ID' },
  { labelKey: 'common.documentType.passportCard', value: 'IP' },
]

/** Document types an applicant may request for a DSC (including the I wildcard). */
export const dscDocumentTypeValues: readonly DocumentTypeOption<DocumentTypeCode>[] = [
  ...documentTypeValues,
  { labelKey: 'common.documentType.iStar', value: 'I' },
]

const LABEL_KEYS: Record<string, string> = {
  P: 'common.documentType.passport',
  ID: 'common.documentType.identityCard',
  IP: 'common.documentType.passportCard',
  I: 'common.documentType.iStar',
}

/** The i18n label key for a document type, or null when it is unknown. */
export function documentTypeLabelKey(value: string): string | null {
  return LABEL_KEYS[value.toUpperCase()] ?? null
}

/** Formats a document type as "Name (CODE)", falling back to the raw value. */
export function documentTypeLabel(value: string, t: (key: string) => string): string {
  const key = documentTypeLabelKey(value)
  return key ? t(key) : value
}

const DISPLAY_ORDER = new Map<string, number>(
  DOCUMENT_TYPES.map((definition, index) => [definition.code, index]),
)

/** Formats a DSC's DocumentType list in catalog order (P, ID, IP, I). */
export function documentTypesLabel(values: readonly string[], t: (key: string) => string): string {
  if (values.length === 0) return '—'
  const ordered = [...values].sort(
    (a, b) =>
      (DISPLAY_ORDER.get(a.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) -
      (DISPLAY_ORDER.get(b.toUpperCase()) ?? Number.MAX_SAFE_INTEGER),
  )
  return ordered
    .map((value) => documentTypeLabel(value, t))
    .join(t('common.documentType.separator'))
}
