/**
 * One-time delivery (M8): atomic consumption, masked-preview hand-off and the
 * confirm/consume and mail tokens.
 */
import { and, desc, eq, isNull } from 'drizzle-orm'

import { AppError } from '@epass42/shared'

import type { Db } from '../../db/client'
import { mailToken, revealToken, signRequest } from '../../db/schema'
import { hashToken, randomToken } from '../../crypto/secret'
import { isExpired, isoInSeconds, nowIso } from '../../util/time'
import type { DscArtifactService } from './artifacts'
import type { DscRequestService, SignRequestRow } from './requests'

/** A one-time perso hand-off. */
export interface RevealResult {
  perso: string
  row: SignRequestRow
}

/** One-time delivery and token management. */
export class DscDeliveryService {
  constructor(
    private readonly db: Db,
    private readonly requests: DscRequestService,
    private readonly artifacts: DscArtifactService,
  ) {}

  /** Atomically consumes a request (single transaction, idempotent guard). */
  private consume(row: SignRequestRow, actorAccountId: number | null, channel: string): void {
    const result = this.db
      .update(signRequest)
      .set({ consumedAt: nowIso(), consumedBy: actorAccountId, consumedChannel: channel })
      .where(and(eq(signRequest.reference, row.reference), isNull(signRequest.consumedAt)))
      .run()
    if (result.changes === 0) {
      throw new AppError('request_already_consumed', 'request already consumed', 410)
    }
  }

  private revealApplicant(row: SignRequestRow, actorAccountId: number | null): RevealResult {
    if (row.status !== 'approved')
      throw new AppError('request_not_approved', 'request not approved', 409)
    if (row.deliveryMode !== 'applicant') {
      throw new AppError('reveal_not_allowed', 'delivery is restricted to reviewers', 403)
    }
    this.consume(row, actorAccountId, 'applicant')
    const perso = this.artifacts.readArtifact(row)
    this.artifacts.destroyArtifact(row)
    return { perso, row }
  }

  /** One-time reveal via reference (delivery mode A). */
  revealByReference(reference: string, actorAccountId: number | null): RevealResult {
    const row = this.requests.getByReference(reference)
    if (!row) throw new AppError('request_not_found', 'request not found', 404)
    return this.revealApplicant(row, actorAccountId)
  }

  /** One-time reveal for the owner (delivery mode A), by resolved row. */
  revealOwned(row: SignRequestRow, actorAccountId: number | null): RevealResult {
    return this.revealApplicant(row, actorAccountId)
  }

  /** One-time reveal by reference for a reviewer / NIA admin (delivery mode B). */
  revealForReviewer(reference: string, actorAccountId: number | null): RevealResult {
    const row = this.requests.getByReference(reference)
    if (!row) throw new AppError('request_not_found', 'request not found', 404)
    if (row.status !== 'approved')
      throw new AppError('request_not_approved', 'request not approved', 409)
    this.consume(row, actorAccountId, 'reviewer')
    const perso = this.artifacts.readArtifact(row)
    this.artifacts.destroyArtifact(row)
    return { perso, row }
  }

  /** The mode-B "to be produced" queue. */
  adminQueue(): SignRequestRow[] {
    return this.db
      .select()
      .from(signRequest)
      .orderBy(desc(signRequest.createdAt))
      .all()
      .filter(
        (row) =>
          row.status === 'approved' && row.deliveryMode === 'reviewer' && row.consumedAt === null,
      )
  }

  /** Creates a reveal token (kind `confirm`) and returns the raw token. */
  createRevealToken(
    signRequestReference: string,
    kind: 'confirm' | 'consume',
    ttlSeconds: number,
  ): string {
    const token = randomToken(24)
    this.db
      .insert(revealToken)
      .values({
        tokenHash: hashToken(token),
        kind,
        signRequestReference,
        expiresAt: isoInSeconds(ttlSeconds),
      })
      .run()
    return token
  }

  /** Resolves a reveal token, rejecting expired/used tokens. */
  resolveRevealToken(raw: string): SignRequestRow {
    const row = this.db
      .select()
      .from(revealToken)
      .where(eq(revealToken.tokenHash, hashToken(raw)))
      .get()
    if (!row || row.usedAt !== null) throw new AppError('token_invalid', 'invalid token', 404)
    if (isExpired(row.expiresAt)) {
      throw new AppError('token_expired', 'token expired', 410)
    }
    return this.requests.getByReference(row.signRequestReference as string) as SignRequestRow
  }

  /** Creates a mail token record. */
  createMailToken(signRequestReference: string, purpose: string, ttlSeconds: number): string {
    const token = randomToken(24)
    this.db
      .insert(mailToken)
      .values({
        tokenHash: hashToken(token),
        purpose,
        signRequestReference,
        expiresAt: isoInSeconds(ttlSeconds),
      })
      .run()
    return token
  }
}
