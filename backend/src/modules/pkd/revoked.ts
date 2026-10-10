/**
 * Public revoked-document directory (an SLTD-like surface, M9).
 *
 * A revoked passport is identified by the SHA-256 of its printed MRZ lookup
 * fields, so the list can be published without exposing personal data: a
 * relying party hashes the document it holds and compares.  The hash is
 * deliberately unsalted (interoperability requires every party to compute the
 * same value), so treat the document-number space as enumerable.
 */
import { desc } from 'drizzle-orm'

import { sha256 } from '@epass42/pki'
import type { SignRequest } from '@epass42/shared'

import type { Db } from '../../db/client'
import { signRequest } from '../../db/schema'

/** The fields covered by the hash, in canonical order. */
export const REVOKE_HASH_FIELDS = [
  'documentCode',
  'issuingState',
  'documentNumber',
  'dateOfBirth',
] as const

/** The hash algorithm advertised on the directory endpoint. */
export const REVOKE_HASH_ALGORITHM = 'sha256'

/** A human-readable description of the canonical form that gets hashed. */
export const REVOKE_HASH_CANONICAL =
  'UPPER-CASE, "<" fillers and whitespace removed, fields joined with "|"'

/** The MRZ fields a relying party reads from a document to look it up. */
export interface DocumentLookup {
  documentCode: string
  issuingState: string
  documentNumber: string
  dateOfBirth: string
}

/** A published revoked document (no personal data). */
export interface RevokedDocument {
  hash: string
  documentCode: string
  revokedAt: string | null
}

/** Normalises an MRZ field: upper-case, fillers and whitespace removed. */
function canonicalField(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[<\s]/g, '')
}

/** The canonical string hashed for a document (see {@link REVOKE_HASH_CANONICAL}). */
export function canonicalDocument(document: DocumentLookup): string {
  return [
    canonicalField(document.documentCode),
    canonicalField(document.issuingState),
    canonicalField(document.documentNumber),
    canonicalField(document.dateOfBirth),
  ].join('|')
}

/** The hex SHA-256 of a document's canonical MRZ lookup fields. */
export function revokedDocumentHash(document: DocumentLookup): string {
  const bytes = new TextEncoder().encode(canonicalDocument(document))
  return Buffer.from(sha256(bytes)).toString('hex')
}

/**
 * Every revoked passport hash, newest revocation first and de-duplicated (a
 * document revoked more than once is published once).
 */
export function listRevokedDocuments(db: Db): RevokedDocument[] {
  const rows = db.select().from(signRequest).orderBy(desc(signRequest.revokedAt)).all()
  const seen = new Set<string>()
  const items: RevokedDocument[] = []
  for (const row of rows) {
    if (row.status !== 'revoked') continue
    const payload = JSON.parse(row.payloadJson) as SignRequest
    if (!payload.mrz) continue
    const hash = revokedDocumentHash(payload.mrz)
    if (seen.has(hash)) continue
    seen.add(hash)
    items.push({ hash, documentCode: payload.mrz.documentCode, revokedAt: row.revokedAt })
  }
  return items
}

/** Whether a document, identified by its hash, is on the revocation list. */
export function isRevokedHash(db: Db, hash: string): boolean {
  const wanted = hash.toLowerCase()
  return listRevokedDocuments(db).some((item) => item.hash === wanted)
}
