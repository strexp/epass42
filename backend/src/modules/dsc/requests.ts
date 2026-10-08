/**
 * DSC request intake and status (M7/M8): submission, lookup, listing, metadata
 * and the non-destructive masked preview.
 */
import { and, desc, eq } from 'drizzle-orm'

import type { SignRequest } from '@pkd42/shared'
import { AppError } from '@pkd42/shared'
import { buildDg2, fromBase64, validateDg2 } from '@pkd42/pki'

import type { Db } from '../../db/client'
import { dscCert, signRequest } from '../../db/schema'
import { hashToken, randomToken } from '../../crypto/secret'
import { nowIso } from '../../util/time'
import { mntDelegatesToNia, canReview, type DscScope } from '../auth/authorization'
import { mrzExpiry } from './build'
import type { DscSettingsService } from './settings'
import { buildPreview, type RequestPreview } from './preview'
import { dataGroupList } from './dataGroups'

export type SignRequestRow = typeof signRequest.$inferSelect

/** Who is submitting the request (may be anonymous). */
export interface Requester {
  accountId: number | null
  /** Canonical (sorted, comma-joined) maintainers of the requesting IP. */
  mnt: string | null
  ip: string | null
}

/** The result of submitting a request. */
export interface SubmitResult {
  reference: string
  id: number
  status: string
}

/** A caught SQLite uniqueness violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    String((error as { code?: string }).code).includes('SQLITE_CONSTRAINT')
  )
}

/** DSC signing request intake, lookup and preview. */
export class DscRequestService {
  constructor(
    private readonly db: Db,
    private readonly settings: DscSettingsService,
  ) {}

  /**
   * Derives the Document Signer selection.  The applicant does not choose: it
   * follows the maintainer delegation setting (NIA DSC) or the maintainer's own
   * active DSC.
   */
  private resolveDscSelection(
    requester: Requester,
    payload: SignRequest,
  ): { mode: 'nia' | 'owned'; certId: number | null } {
    if (payload.dscSelection) {
      return {
        mode: payload.dscSelection.mode,
        certId: payload.dscSelection.mode === 'owned' ? payload.dscSelection.dscCertId : null,
      }
    }
    if (requester.mnt !== null && !mntDelegatesToNia(this.db, requester.mnt)) {
      const own = this.db
        .select()
        .from(dscCert)
        .where(and(eq(dscCert.mnt, requester.mnt), eq(dscCert.status, 'active')))
        .get()
      if (own) return { mode: 'owned', certId: own.id }
    }
    return { mode: 'nia', certId: null }
  }

  /** Creates a signing request and returns its one-time reference. */
  submit(payload: SignRequest, requester: Requester): SubmitResult {
    const reference = randomToken(24)
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const selection = this.resolveDscSelection(requester, payload)
    // The document expiry is derived from the issuing profile validity.
    const profile = this.settings.issuingDefaults()
    // Reject an oversized face before persisting the request.
    const dg2 = buildDg2(fromBase64(payload.dg2.jpeg), payload.dg2.width, payload.dg2.height)
    validateDg2(dg2)
    if (dg2.length > profile.dg2MaxBytes) {
      throw new AppError(
        'dg2_too_large',
        `DG2 is ${dg2.length} bytes, above the ${profile.dg2MaxBytes}-byte limit`,
        413,
      )
    }
    const effectivePayload: SignRequest = {
      ...payload,
      mrz: {
        ...payload.mrz,
        // Issuing state, nationality and expiry are server-owned.
        issuingState: profile.issuingState as SignRequest['mrz']['issuingState'],
        nationality: profile.issuingState,
        dateOfExpiry: mrzExpiry(profile.validityYears),
      },
    }
    let result
    try {
      result = this.db
        .insert(signRequest)
        .values({
          referenceHash: hashToken(reference),
          requesterAccountId: requester.accountId,
          mnt: requester.mnt,
          ip: requester.ip,
          dscSelection: selection.mode,
          dscCertId: selection.certId,
          payloadJson: JSON.stringify(effectivePayload),
          status: 'submitted',
          deliveryMode: this.settings.getDeliveryMode(),
          email: payload.email ?? null,
          createdAt,
          expiresAt,
        })
        .run()
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          'document_number_conflict',
          'document number already exists for this AS',
          409,
        )
      }
      throw error
    }
    return { reference, id: Number(result.lastInsertRowid), status: 'submitted' }
  }

  /** Loads a request by its raw reference token. */
  getByReference(reference: string): SignRequestRow | undefined {
    return this.db
      .select()
      .from(signRequest)
      .where(eq(signRequest.referenceHash, hashToken(reference)))
      .get()
  }

  /** Loads a request by id. */
  getById(id: number): SignRequestRow | undefined {
    return this.db.select().from(signRequest).where(eq(signRequest.id, id)).get()
  }

  /** Lists requests visible to a scope or an account. */
  list(options: {
    scope?: DscScope
    accountId?: number
    status?: string
    limit?: number
    offset?: number
  }): SignRequestRow[] {
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const rows = this.db.select().from(signRequest).orderBy(desc(signRequest.id)).all()
    return rows
      .filter((row) => {
        if (options.status && row.status !== options.status) return false
        if (options.scope) {
          return canReview(options.scope, { mnt: row.mnt, dscSelection: row.dscSelection })
        }
        if (options.accountId !== undefined) return row.requesterAccountId === options.accountId
        return true
      })
      .slice(offset, offset + limit)
  }

  /** Metadata safe to return for a request reference (no artifact bytes). */
  metadata(row: SignRequestRow): Record<string, unknown> {
    const payload = JSON.parse(row.payloadJson) as SignRequest
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      deliveryMode: row.deliveryMode,
      consumedAt: row.consumedAt,
      dscSelection: row.dscSelection,
      mnt: row.mnt,
      dataGroups: dataGroupList(payload, this.settings.issuingDefaults().security),
      email: row.email,
    }
  }

  /** Builds the non-destructive masked preview for a reference. */
  preview(reference: string): RequestPreview | null {
    const row = this.getByReference(reference)
    if (!row) return null
    const payload = JSON.parse(row.payloadJson) as SignRequest
    return buildPreview(
      payload,
      undefined,
      payload.security ?? this.settings.issuingDefaults().security,
    )
  }
}
