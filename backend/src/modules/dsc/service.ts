/**
 * DSC signing service (M7): request intake, status, review and perso build.
 *
 * Requests carry only structured fields.  The perso is built on approval and
 * stored as an encrypted artifact (M13); AA/CA private keys live only inside
 * that artifact.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { SignRequest } from '@pkd42/shared'
import { AppError } from '@pkd42/shared'
import { verifySod } from '@pkd42/pki'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import {
  artifact,
  dscCert,
  issuingProfile,
  mailToken,
  revealToken,
  signRequest,
  systemSetting,
} from '../../db/schema'
import { hashToken, randomToken } from '../../crypto/secret'
import { isExpired, isoInSeconds, nowIso } from '../../util/time'
import { currentNiaDsc, CscaService, type DscCertRow } from '../csca/service'
import type { DscScope } from '../auth/authorization'
import { canReview } from '../auth/authorization'
import {
  buildPersoSigning,
  type IssuingDefaults,
  type PersoBuildResult,
  type SigningMaterial,
} from './build'
import { buildPreview, type RequestPreview } from './preview'

export type SignRequestRow = typeof signRequest.$inferSelect

/** Who is submitting the request (may be anonymous). */
export interface Requester {
  accountId: number | null
  asn: number | null
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

/** DSC signing service. */
export class DscService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly csca: CscaService,
  ) {}

  /** The current issuing defaults (config overlaid by the DB profile row). */
  issuingDefaults(overrides: Partial<IssuingDefaults> = {}): IssuingDefaults {
    const row = this.db.select().from(issuingProfile).orderBy(desc(issuingProfile.id)).get()
    const extra = row?.defaultsJson
      ? (JSON.parse(row.defaultsJson) as Partial<IssuingDefaults>)
      : {}
    return {
      issuingState: row?.issuingState ?? this.config.issuing.issuingState,
      issuingAuthority: row?.issuingAuthority ?? this.config.issuing.issuingAuthority,
      personalizationDevice:
        row?.personalizationDevice ?? this.config.issuing.personalizationDevice,
      dg13Policy: row?.dg13Policy ?? this.config.issuing.dg13Policy,
      endorsements: row?.endorsementsJson ?? undefined,
      ...extra,
      ...overrides,
    }
  }

  /** Creates a signing request and returns its one-time reference. */
  submit(payload: SignRequest, requester: Requester): SubmitResult {
    const reference = randomToken(24)
    const createdAt = nowIso()
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const dscSelection = payload.dscSelection.mode
    let result
    try {
      result = this.db
        .insert(signRequest)
        .values({
          referenceHash: hashToken(reference),
          requesterAccountId: requester.accountId,
          asn: requester.asn,
          ip: requester.ip,
          dscSelection,
          dscCertId: payload.dscSelection.mode === 'owned' ? payload.dscSelection.dscCertId : null,
          payloadJson: JSON.stringify(payload),
          status: 'submitted',
          deliveryMode: 'applicant',
          deliveryOverride: false,
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
          return canReview(options.scope, { asn: row.asn, dscSelection: row.dscSelection })
        }
        if (options.accountId !== undefined) return row.requesterAccountId === options.accountId
        return true
      })
      .slice(offset, offset + limit)
  }

  /** Resolves the Document Signer material for a request. */
  async selectSigningMaterial(row: SignRequestRow): Promise<SigningMaterial> {
    if (row.dscSelection === 'owned') {
      if (!row.dscCertId) throw new AppError('certificate_not_found', 'owned DSC id missing', 400)
      const cert = this.db.select().from(dscCert).where(eq(dscCert.id, row.dscCertId)).get()
      if (!cert || cert.status !== 'active') {
        throw new AppError('certificate_not_found', 'owned DSC not found or inactive', 400)
      }
      if (row.asn !== null && cert.asn !== null && cert.asn !== row.asn) {
        throw new AppError('forbidden', 'owned DSC does not belong to the requester AS', 403)
      }
      return { certPem: cert.certPem, keyPair: await this.csca.loadDscKeyPair(cert) }
    }
    let nia: DscCertRow | undefined = currentNiaDsc(this.db)
    if (!nia) nia = await this.csca.ensureNiaDsc()
    if (!nia) throw new AppError('certificate_not_found', 'no NIA DSC available', 500)
    return { certPem: nia.certPem, keyPair: await this.csca.loadDscKeyPair(nia) }
  }

  /** Builds and stores the perso artifact for an approved request. */
  async buildArtifact(
    row: SignRequestRow,
    overrides: Partial<IssuingDefaults> = {},
  ): Promise<PersoBuildResult & { artifactId: number }> {
    const payload = JSON.parse(row.payloadJson) as SignRequest
    const profile = this.issuingDefaults(overrides)
    const material = await this.selectSigningMaterial(row)
    const built = await buildPersoSigning(payload, profile, material)

    // Self-check: re-verify the CMS signature and every data group hash.
    const check = await verifySod(
      built.sod,
      new Map(built.groups.map((group) => [group.number, group.bytes])),
    )
    if (!check.valid) {
      throw new AppError(
        'signature_invalid',
        `SOD self-check failed: ${check.errors.join('; ')}`,
        500,
      )
    }

    const dir = join(this.config.dataDir, 'artifacts')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `perso-${row.id}.txt`)
    writeFileSync(path, built.perso, { mode: 0o600 })
    const inserted = this.db
      .insert(artifact)
      .values({
        kind: 'perso',
        path,
        sha256: built.sha256,
        size: Buffer.byteLength(built.perso),
        enc: false,
        createdAt: nowIso(),
      })
      .run()
    const artifactId = Number(inserted.lastInsertRowid)
    this.db
      .update(signRequest)
      .set({ resultArtifactId: artifactId })
      .where(eq(signRequest.id, row.id))
      .run()
    return { ...built, artifactId }
  }

  /** Approves a request: builds the artifact and snapshots the delivery mode. */
  async approve(
    row: SignRequestRow,
    actorAccountId: number | null,
    options: {
      deliveryMode?: 'applicant' | 'reviewer'
      profileOverrides?: Partial<IssuingDefaults>
    } = {},
  ): Promise<SignRequestRow> {
    const built = await this.buildArtifact(row, options.profileOverrides ?? {})
    this.db
      .update(signRequest)
      .set({
        status: 'approved',
        reviewedBy: actorAccountId,
        reviewedAt: nowIso(),
        deliveryMode: options.deliveryMode ?? row.deliveryMode,
        deliveryOverride:
          options.deliveryMode !== undefined && options.deliveryMode !== row.deliveryMode,
        profileOverrides:
          options.profileOverrides !== undefined
            ? JSON.stringify(options.profileOverrides)
            : row.profileOverrides,
      })
      .where(eq(signRequest.id, row.id))
      .run()
    void built
    return this.getById(row.id) as SignRequestRow
  }

  /** Rejects a request. */
  reject(row: SignRequestRow, actorAccountId: number | null, reason: string): SignRequestRow {
    this.db
      .update(signRequest)
      .set({
        status: 'rejected',
        reviewedBy: actorAccountId,
        reviewedAt: nowIso(),
        consumedChannel: reason,
      })
      .where(and(eq(signRequest.id, row.id)))
      .run()
    return this.getById(row.id) as SignRequestRow
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
      dataGroups: dataGroupList(payload),
      email: row.email,
    }
  }

  /* ---------------------------------------------------------------- *
   * Delivery (M8)
   * ---------------------------------------------------------------- */

  /** The system delivery mode. */
  getDeliveryMode(): 'applicant' | 'reviewer' {
    const row = this.db
      .select()
      .from(systemSetting)
      .where(eq(systemSetting.key, 'dsc.delivery_mode'))
      .get()
    return row?.value === 'reviewer' ? 'reviewer' : 'applicant'
  }

  /** Updates the system delivery mode. */
  setDeliveryMode(value: 'applicant' | 'reviewer', actorAccountId: number | null): void {
    this.db
      .insert(systemSetting)
      .values({ key: 'dsc.delivery_mode', value, updatedBy: actorAccountId, updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: systemSetting.key,
        set: { value, updatedBy: actorAccountId, updatedAt: nowIso() },
      })
      .run()
  }

  /** Updates the issuing profile defaults. */
  updateIssuingProfile(
    values: Partial<IssuingDefaults>,
    actorAccountId: number | null,
  ): IssuingDefaults {
    const current = this.issuingDefaults()
    const merged = this.issuingDefaults(values)
    const row = this.db.select().from(issuingProfile).orderBy(desc(issuingProfile.id)).get()
    const record = {
      issuingState: merged.issuingState,
      issuingAuthority: merged.issuingAuthority,
      personalizationDevice: merged.personalizationDevice,
      dg13Policy: merged.dg13Policy,
      endorsementsJson: merged.endorsements ?? null,
      defaultsJson: JSON.stringify(merged),
      updatedBy: actorAccountId,
      updatedAt: nowIso(),
    }
    void current
    if (row) {
      this.db.update(issuingProfile).set(record).where(eq(issuingProfile.id, row.id)).run()
    } else {
      this.db.insert(issuingProfile).values(record).run()
    }
    return merged
  }

  /** Builds the non-destructive masked preview for a reference. */
  preview(reference: string): RequestPreview | null {
    const row = this.getByReference(reference)
    if (!row) return null
    return buildPreview(JSON.parse(row.payloadJson) as SignRequest)
  }

  /** Atomically consumes a request (single transaction, idempotent guard). */
  private consume(row: SignRequestRow, actorAccountId: number | null, channel: string): void {
    const result = this.db
      .update(signRequest)
      .set({ consumedAt: nowIso(), consumedBy: actorAccountId, consumedChannel: channel })
      .where(and(eq(signRequest.id, row.id), isNull(signRequest.consumedAt)))
      .run()
    if (result.changes === 0) {
      throw new AppError('request_already_consumed', 'request already consumed', 410)
    }
  }

  /** Reads the stored perso artifact for a request. */
  private readPerso(row: SignRequestRow): string {
    if (!row.resultArtifactId) throw new AppError('request_not_approved', 'no artifact', 409)
    const art = this.db.select().from(artifact).where(eq(artifact.id, row.resultArtifactId)).get()
    if (!art) throw new AppError('request_not_approved', 'no artifact', 409)
    return readFileSync(art.path, 'utf8')
  }

  /** One-time reveal via reference (delivery mode A). */
  revealByReference(
    reference: string,
    actorAccountId: number | null,
  ): { perso: string; row: SignRequestRow } {
    const row = this.getByReference(reference)
    if (!row) throw new AppError('request_not_found', 'request not found', 404)
    if (row.status !== 'approved')
      throw new AppError('request_not_approved', 'request not approved', 409)
    if (row.deliveryMode !== 'applicant') {
      throw new AppError('reveal_not_allowed', 'delivery is restricted to reviewers', 403)
    }
    this.consume(row, actorAccountId, 'applicant')
    return { perso: this.readPerso(row), row }
  }

  /** One-time reveal by id (admin / delivery mode B). */
  revealById(id: number, actorAccountId: number | null): { perso: string; row: SignRequestRow } {
    const row = this.getById(id)
    if (!row) throw new AppError('request_not_found', 'request not found', 404)
    if (row.status !== 'approved')
      throw new AppError('request_not_approved', 'request not approved', 409)
    this.consume(row, actorAccountId, 'reviewer')
    return { perso: this.readPerso(row), row }
  }

  /** The mode-B "to be produced" queue. */
  adminQueue(): SignRequestRow[] {
    return this.db
      .select()
      .from(signRequest)
      .orderBy(desc(signRequest.id))
      .all()
      .filter(
        (row) =>
          row.status === 'approved' && row.deliveryMode === 'reviewer' && row.consumedAt === null,
      )
  }

  /** Rebuilds the artifact for an already-produced request (new AA/CA keys). */
  async regenerate(row: SignRequestRow, _actorAccountId: number | null): Promise<SignRequestRow> {
    const built = await this.buildArtifact(row)
    this.db
      .update(signRequest)
      .set({
        status: 'approved',
        consumedAt: null,
        consumedBy: null,
        consumedChannel: null,
        regeneratedFrom: row.id,
        reviewedAt: nowIso(),
      })
      .where(eq(signRequest.id, row.id))
      .run()
    void built
    return this.getById(row.id) as SignRequestRow
  }

  /** Creates a reveal token (kind `confirm`) and returns the raw token. */
  createRevealToken(
    signRequestId: number,
    kind: 'confirm' | 'consume',
    ttlSeconds: number,
  ): string {
    const token = randomToken(24)
    this.db
      .insert(revealToken)
      .values({
        tokenHash: hashToken(token),
        kind,
        signRequestId,
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
    return this.getById(row.signRequestId as number) as SignRequestRow
  }

  /** Creates a mail token record. */
  createMailToken(signRequestId: number, purpose: string, ttlSeconds: number): string {
    const token = randomToken(24)
    this.db
      .insert(mailToken)
      .values({
        tokenHash: hashToken(token),
        purpose,
        signRequestId,
        expiresAt: isoInSeconds(ttlSeconds),
      })
      .run()
    return token
  }
}

/** The data group numbers a request will produce (for metadata/preview). */
export function dataGroupList(payload: SignRequest): number[] {
  const groups = [1, 2, 14]
  if (payload.dg3) groups.push(3)
  if (payload.dg4) groups.push(4)
  if (payload.dg5) groups.push(5)
  if (payload.dg7) groups.push(7)
  if (payload.dg11) groups.push(11)
  if (payload.dg12) groups.push(12)
  if (payload.dg13) groups.push(13)
  if (payload.dg16) groups.push(16)
  if (payload.security.aa) groups.push(15)
  return [...new Set(groups)].sort((a, b) => a - b)
}
