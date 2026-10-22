/**
 * DSC artifact build and review (M7/M8): Document Signer selection, perso
 * build, approval, rejection and regeneration.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'

import type { SignRequest } from '@epass42/shared'
import { AppError } from '@epass42/shared'
import { certificateCoversDocumentType, parseCertificatePem, verifySod } from '@epass42/pki'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { artifact, dscCert, signRequest } from '../../db/schema'
import { randomToken } from '../../crypto/secret'
import { nowIso } from '../../util/time'
import { currentNiaDsc, type CscaService } from '../csca/service'
import type { CvcaService } from '../cvca/service'
import { mntIncludes } from '../jurisdiction/whois'
import {
  buildPersoSigning,
  type IssuingDefaults,
  type PersoBuildResult,
  type SigningMaterial,
} from './build'
import type { DscSettingsService } from './settings'
import type { DscRequestService, SignRequestRow } from './requests'

/** DSC perso build and review actions. */
export class DscArtifactService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly csca: CscaService,
    private readonly cvca: CvcaService,
    private readonly settings: DscSettingsService,
    private readonly requests: DscRequestService,
  ) {}

  /** Resolves the Document Signer material for a request. */
  async selectSigningMaterial(row: SignRequestRow): Promise<SigningMaterial> {
    const payload = JSON.parse(row.payloadJson) as SignRequest
    const documentType = payload.mrz.documentCode

    if (row.dscSelection === 'owned') {
      if (!row.dscCertId) throw new AppError('certificate_not_found', 'owned DSC id missing', 400)
      const cert = this.db.select().from(dscCert).where(eq(dscCert.id, row.dscCertId)).get()
      // Only a Document Signer may sign an EF.SOD; LDS2 Signer certificates
      // carry a different ExtendedKeyUsage and are never selectable here.
      if (!cert || cert.certificateType !== 'dsc' || cert.status !== 'active') {
        throw new AppError('certificate_not_found', 'owned DSC not found or inactive', 400)
      }
      if (row.mnt !== null && cert.mnt !== null && !mntIncludes(row.mnt, cert.mnt)) {
        throw new AppError(
          'forbidden',
          'owned DSC does not belong to the requester maintainer',
          403,
        )
      }
      this.assertDocumentTypeCovered(cert.certPem, documentType)
      return {
        certPem: cert.certPem,
        keyPair: await this.csca.loadDscKeyPair(cert, this.config.csca.niaDsc.hash),
        hash: this.config.csca.niaDsc.hash,
      }
    }
    let nia = currentNiaDsc(this.db)
    if (!nia) nia = await this.csca.ensureNiaDsc()
    if (!nia) throw new AppError('certificate_not_found', 'no NIA DSC available', 500)
    this.assertDocumentTypeCovered(nia.certPem, documentType)
    return {
      certPem: nia.certPem,
      keyPair: await this.csca.loadDscKeyPair(nia, this.config.csca.niaDsc.hash),
      hash: this.config.csca.niaDsc.hash,
    }
  }

  /**
   * Refuses to sign a document with a DSC whose DocumentType extension does not
   * authorize it (Doc 9303-12 §7.1.1).  The built-in NIA DSC covers `P` and all
   * `I*` types when configured with `["P", "I"]`.
   */
  private assertDocumentTypeCovered(certPem: string, documentType: string): void {
    if (!certificateCoversDocumentType(parseCertificatePem(certPem), documentType)) {
      throw new AppError(
        'dsc_document_type_mismatch',
        `the Document Signer is not authorized for document type ${documentType}`,
        409,
      )
    }
  }

  /** Builds and stores the perso artifact for an approved request. */
  async buildArtifact(
    row: SignRequestRow,
    overrides: Partial<IssuingDefaults> = {},
  ): Promise<PersoBuildResult & { artifactId: string }> {
    const payload = JSON.parse(row.payloadJson) as SignRequest
    const profile = this.settings.issuingDefaults(overrides)
    const material = await this.selectSigningMaterial(row)
    const trustAnchor = profile.security.ta.enabled ? this.cvca.trustAnchor() : undefined
    const built = await buildPersoSigning(payload, profile, material, trustAnchor)

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
    const path = join(dir, `perso-${row.reference}.txt`)
    // The perso carries the AA/CA private keys: seal it at rest (M13/T13.10).
    const sealed = this.csca.seal(new TextEncoder().encode(built.perso))
    writeFileSync(path, sealed, { mode: 0o600 })
    const artifactId = randomToken(16)
    this.db
      .insert(artifact)
      .values({
        id: artifactId,
        kind: 'perso',
        path,
        sha256: built.sha256,
        size: Buffer.byteLength(built.perso),
        enc: true,
        createdAt: nowIso(),
      })
      .run()
    this.db
      .update(signRequest)
      .set({ resultArtifactId: artifactId })
      .where(eq(signRequest.reference, row.reference))
      .run()
    return { ...built, artifactId }
  }

  /** Reads (and decrypts) the stored perso artifact for a request. */
  readArtifact(row: SignRequestRow): string {
    if (!row.resultArtifactId) throw new AppError('request_not_approved', 'no artifact', 409)
    const art = this.db.select().from(artifact).where(eq(artifact.id, row.resultArtifactId)).get()
    if (!art) throw new AppError('request_not_approved', 'no artifact', 409)
    const contents = readFileSync(art.path, 'utf8')
    return art.enc ? new TextDecoder().decode(this.csca.open(contents)) : contents
  }

  /**
   * Securely destroys a request's artifact (M13/T13.9): removes the sealed file
   * and its database row so a consumed request leaves no bytes behind.
   */
  destroyArtifact(row: SignRequestRow): void {
    if (!row.resultArtifactId) return
    // Null the reference first: the FK from sign_request to artifact would
    // otherwise block deleting the artifact row.
    this.db
      .update(signRequest)
      .set({ resultArtifactId: null })
      .where(eq(signRequest.reference, row.reference))
      .run()
    const art = this.db.select().from(artifact).where(eq(artifact.id, row.resultArtifactId)).get()
    if (art) {
      rmSync(art.path, { force: true })
      this.db.delete(artifact).where(eq(artifact.id, art.id)).run()
    }
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
    await this.buildArtifact(row, options.profileOverrides ?? {})
    this.db
      .update(signRequest)
      .set({
        status: 'approved',
        reviewedBy: actorAccountId,
        reviewedAt: nowIso(),
        deliveryMode: options.deliveryMode ?? row.deliveryMode,
        profileOverrides:
          options.profileOverrides !== undefined
            ? JSON.stringify(options.profileOverrides)
            : row.profileOverrides,
      })
      .where(eq(signRequest.reference, row.reference))
      .run()
    // Re-issuance: the newly approved document supersedes and invalidates any
    // previous active document of the applicant, keeping a single usable one.
    if (row.requesterAccountId !== null) {
      for (const previous of this.requests.activePassports(row.requesterAccountId)) {
        if (previous.reference === row.reference) continue
        this.destroyArtifact(previous)
        this.requests.revoke(previous, 'superseded by a new document')
      }
    }
    return this.requests.getByReference(row.reference) as SignRequestRow
  }

  /** Rejects a request. */
  reject(row: SignRequestRow, actorAccountId: number | null, reason: string): SignRequestRow {
    this.db
      .update(signRequest)
      .set({
        status: 'rejected',
        reviewedBy: actorAccountId,
        reviewedAt: nowIso(),
        rejectReason: reason,
      })
      .where(eq(signRequest.reference, row.reference))
      .run()
    return this.requests.getByReference(row.reference) as SignRequestRow
  }

  /** Rebuilds the artifact for an already-produced request (new AA/CA keys). */
  async regenerate(row: SignRequestRow, _actorAccountId: number | null): Promise<SignRequestRow> {
    // Drop the old sealed artifact before producing the replacement.
    this.destroyArtifact(row)
    await this.buildArtifact(row)
    this.db
      .update(signRequest)
      .set({
        status: 'approved',
        consumedAt: null,
        consumedBy: null,
        consumedChannel: null,
        regeneratedFrom: row.reference,
        reviewedAt: nowIso(),
      })
      .where(eq(signRequest.reference, row.reference))
      .run()
    return this.requests.getByReference(row.reference) as SignRequestRow
  }
}
