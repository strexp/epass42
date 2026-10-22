/**
 * ICAO Doc 9303 document types used by ePass 42.
 *
 * A Document Signer certificate lists the document types it may sign in its
 * DocumentType extension (Doc 9303-12 §7.1.1).  The values are the document
 * codes as they appear in the MRZ; a single letter is a wildcard for every
 * document type starting with that letter.  ePass 42 therefore keeps the
 * concrete issue types (`P`, `ID`, `IP`) separate from the `I` wildcard that
 * authorizes every `I*` document type.
 */
import { z } from 'zod'

/** Every DocumentType value accepted in a DSC certificate or configuration. */
export const DOCUMENT_TYPE_CODES = ['P', 'ID', 'IP', 'I'] as const
export type DocumentTypeCode = (typeof DOCUMENT_TYPE_CODES)[number]

/** The concrete document types that can be personalized. */
export const DOCUMENT_ISSUE_TYPES = ['P', 'ID', 'IP'] as const
export type DocumentIssueType = (typeof DOCUMENT_ISSUE_TYPES)[number]

/** The MRZ layout used by a concrete document type. */
export type DocumentFormat = 'TD1' | 'TD3'

/** Metadata for one DocumentType value. */
export interface DocumentTypeDefinition {
  code: DocumentTypeCode
  /** MRZ layout, or `null` for the `I` wildcard. */
  format: DocumentFormat | null
  /** True for `I`, which authorizes every document type starting with `I`. */
  wildcard: boolean
  /** True when a document of this type can be personalized. */
  issuable: boolean
}

/** The DocumentType catalog, in display order. */
export const DOCUMENT_TYPES: readonly DocumentTypeDefinition[] = [
  { code: 'P', format: 'TD3', wildcard: false, issuable: true },
  { code: 'ID', format: 'TD1', wildcard: false, issuable: true },
  { code: 'IP', format: 'TD1', wildcard: false, issuable: true },
  { code: 'I', format: null, wildcard: true, issuable: false },
]

const DOCUMENT_TYPE_CODE_SET: ReadonlySet<string> = new Set(DOCUMENT_TYPE_CODES)
const DOCUMENT_ISSUE_TYPE_SET: ReadonlySet<string> = new Set(DOCUMENT_ISSUE_TYPES)
const DOCUMENT_TYPE_BY_CODE = new Map<DocumentTypeCode, DocumentTypeDefinition>(
  DOCUMENT_TYPES.map((definition) => [definition.code, definition]),
)

/** True when `value` is a DocumentType value (including the `I` wildcard). */
export function isDocumentType(value: string): value is DocumentTypeCode {
  return DOCUMENT_TYPE_CODE_SET.has(value.toUpperCase())
}

/** True when `value` is a concrete, personalizable document type. */
export function isDocumentIssueType(value: string): value is DocumentIssueType {
  return DOCUMENT_ISSUE_TYPE_SET.has(value.toUpperCase())
}

/** Normalises and validates a DocumentType value (including `I`). */
export function normalizeDocumentType(value: string): DocumentTypeCode {
  const code = value.trim().toUpperCase()
  if (!isDocumentType(code)) throw new Error(`invalid document type: ${value}`)
  return code
}

/** Normalises and validates a concrete document type (rejects `I`). */
export function normalizeDocumentIssueType(value: string): DocumentIssueType {
  const code = value.trim().toUpperCase()
  if (!isDocumentIssueType(code)) throw new Error(`invalid document issue type: ${value}`)
  return code
}

/** The metadata of a DocumentType value. */
export function documentTypeDefinition(value: string): DocumentTypeDefinition {
  return DOCUMENT_TYPE_BY_CODE.get(normalizeDocumentType(value))!
}

/** The MRZ layout of a concrete document type. */
export function documentFormatOf(value: string): DocumentFormat {
  const definition = documentTypeDefinition(value)
  if (definition.format === null) {
    throw new Error(`document type ${definition.code} is a wildcard, not a document format`)
  }
  return definition.format
}

/**
 * True when an authorized DocumentType list covers a concrete document type.
 *
 * `I` covers `ID` and `IP`; a two-letter value only covers itself.  The
 * requested type must be concrete (a document being personalized), not `I`.
 */
export function documentTypeCovers(authorized: readonly string[], requested: string): boolean {
  const target = normalizeDocumentIssueType(requested)
  return authorized.some((value) => {
    const code = normalizeDocumentType(value)
    if (code === target) return true
    return code.length === 1 && target.startsWith(code)
  })
}

/** Schema for a DocumentType value (including the `I` wildcard). */
export const documentTypeSchema = z.enum(DOCUMENT_TYPE_CODES)

/** Schema for a concrete document type (no `I` wildcard). */
export const documentIssueTypeSchema = z.enum(DOCUMENT_ISSUE_TYPES)

/** Schema for a DSC DocumentType list (one or two unique values). */
export const documentTypeListSchema = z
  .array(documentTypeSchema)
  .min(1)
  .max(2)
  .refine((types) => new Set(types).size === types.length, {
    message: 'duplicate document type',
  })
