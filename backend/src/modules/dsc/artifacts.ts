/**
 * DSC artifact build and review (M7/M8): Document Signer selection, perso
 * build, approval, rejection and regeneration.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'

import type { SignRequest } from '@pkd42/shared'
import { AppError } from '@pkd42/shared'
import { verifySod } from '@pkd42/pki'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { artifact, dscCert, signRequest } from '../../db/schema'
import { nowIso } from '../../util/time'
import { currentNiaDsc, type CscaService } from '../csca/service'
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
    private readonly settings: DscSettingsService,
    private readonly requests: DscRequestService,
  ) {}

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
    let nia = currentNiaDsc(this.db)
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
    const profile = this.settings.issuingDefaults(overrides)
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
      .where(eq(signRequest.id, row.id))
      .run()
    return this.requests.getById(row.id) as SignRequestRow
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
    return this.requests.getById(row.id) as SignRequestRow
  }

  /** Rebuilds the artifact for an already-produced request (new AA/CA keys). */
  async regenerate(row: SignRequestRow, _actorAccountId: number | null): Promise<SignRequestRow> {
    await this.buildArtifact(row)
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
    return this.requests.getById(row.id) as SignRequestRow
  }
}
