/**
 * DSC signing service facade (M7/M8).
 *
 * Composes the focused services — settings, request intake, artifact build and
 * one-time delivery — behind the single entry point consumed by the routes.
 */
import type { SignRequest } from '@epass42/shared'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { CscaService } from '../csca/service'
import type { CvcaService } from '../cvca/service'
import type { IssuingDefaults, PersoBuildResult, SigningMaterial } from './build'
import { DscSettingsService, type IssuingDefaultsUpdate } from './settings'
import {
  DscRequestService,
  type Requester,
  type SubmitResult,
  type SignRequestRow,
} from './requests'
import { DscArtifactService } from './artifacts'
import { DscDeliveryService, type RevealResult } from './delivery'
import { dataGroupList } from './dataGroups'

export type { SignRequestRow } from './requests'
export type { Requester, SubmitResult } from './requests'
export type { IssuingDefaultsUpdate } from './settings'
export type { RevealResult } from './delivery'
export { dataGroupList }

/** DSC signing service. */
export class DscService {
  readonly settings: DscSettingsService
  readonly requests: DscRequestService
  readonly artifacts: DscArtifactService
  readonly delivery: DscDeliveryService
  readonly csca: CscaService

  constructor(db: Db, config: AppConfig, csca: CscaService, cvca: CvcaService) {
    this.csca = csca
    this.settings = new DscSettingsService(db, config)
    this.requests = new DscRequestService(db, this.settings)
    this.artifacts = new DscArtifactService(db, config, csca, cvca, this.settings, this.requests)
    this.delivery = new DscDeliveryService(db, this.requests, this.artifacts)
  }

  /** Whether a valid NIA DSC exists, i.e. new documents may be issued. */
  canIssueDocuments(): boolean {
    return this.csca.hasUsableNiaDsc()
  }

  /** Manually rotates the NIA DSC (admin action; audit is written by the route). */
  rotateNiaDsc(): ReturnType<CscaService['rotateNiaDsc']> {
    return this.csca.rotateNiaDsc()
  }

  /* Settings ----------------------------------------------------------- */

  issuingDefaults(overrides: IssuingDefaultsUpdate = {}): IssuingDefaults {
    return this.settings.issuingDefaults(overrides)
  }

  getDeliveryMode(): 'applicant' | 'reviewer' {
    return this.settings.getDeliveryMode()
  }

  setDeliveryMode(value: 'applicant' | 'reviewer', actorAccountId: number | null): void {
    this.settings.setDeliveryMode(value, actorAccountId)
  }

  updateIssuingProfile(
    values: IssuingDefaultsUpdate,
    actorAccountId: number | null,
  ): IssuingDefaults {
    return this.settings.updateIssuingProfile(values, actorAccountId)
  }

  /* Requests ----------------------------------------------------------- */

  submit(payload: SignRequest, requester: Requester): SubmitResult {
    return this.requests.submit(payload, requester)
  }

  getByReference(reference: string): SignRequestRow | undefined {
    return this.requests.getByReference(reference)
  }

  /** The account's currently active passport, if any. */
  activePassport(accountId: number): SignRequestRow | undefined {
    return this.requests.activePassport(accountId)
  }

  /** Revokes an approved passport so it is no longer active. */
  revokePassport(row: SignRequestRow, reason: string | null): SignRequestRow {
    // Drop any unclaimed perso artifact before marking the passport revoked.
    this.artifacts.destroyArtifact(row)
    return this.requests.revoke(row, reason)
  }

  list(options: Parameters<DscRequestService['list']>[0]): SignRequestRow[] {
    return this.requests.list(options)
  }

  metadata(row: SignRequestRow): Record<string, unknown> {
    return this.requests.metadata(row)
  }

  /** The unmasked structured submission (callers must authorize first). */
  full(row: SignRequestRow): SignRequest {
    return this.requests.full(row)
  }

  preview(reference: string): ReturnType<DscRequestService['preview']> {
    return this.requests.preview(reference)
  }

  /* Artifacts / review ------------------------------------------------- */

  selectSigningMaterial(row: SignRequestRow): Promise<SigningMaterial> {
    return this.artifacts.selectSigningMaterial(row)
  }

  buildArtifact(
    row: SignRequestRow,
    overrides: Partial<IssuingDefaults> = {},
  ): Promise<PersoBuildResult & { artifactId: string }> {
    return this.artifacts.buildArtifact(row, overrides)
  }

  /** Reads (and decrypts) a request's stored perso artifact (sealed at rest). */
  readArtifact(row: SignRequestRow): string {
    return this.artifacts.readArtifact(row)
  }

  approve(
    row: SignRequestRow,
    actorAccountId: number | null,
    options?: Parameters<DscArtifactService['approve']>[2],
  ): Promise<SignRequestRow> {
    return this.artifacts.approve(row, actorAccountId, options)
  }

  reject(row: SignRequestRow, actorAccountId: number | null, reason: string): SignRequestRow {
    return this.artifacts.reject(row, actorAccountId, reason)
  }

  regenerate(row: SignRequestRow, actorAccountId: number | null): Promise<SignRequestRow> {
    return this.artifacts.regenerate(row, actorAccountId)
  }

  /* Delivery ----------------------------------------------------------- */

  revealByReference(reference: string, actorAccountId: number | null): RevealResult {
    return this.delivery.revealByReference(reference, actorAccountId)
  }

  revealOwned(row: SignRequestRow, actorAccountId: number | null): RevealResult {
    return this.delivery.revealOwned(row, actorAccountId)
  }

  revealForReviewer(reference: string, actorAccountId: number | null): RevealResult {
    return this.delivery.revealForReviewer(reference, actorAccountId)
  }

  adminQueue(): SignRequestRow[] {
    return this.delivery.adminQueue()
  }

  createRevealToken(
    signRequestReference: string,
    kind: 'confirm' | 'consume',
    ttlSeconds: number,
  ): string {
    return this.delivery.createRevealToken(signRequestReference, kind, ttlSeconds)
  }

  resolveRevealToken(raw: string): SignRequestRow {
    return this.delivery.resolveRevealToken(raw)
  }

  createMailToken(signRequestReference: string, purpose: string, ttlSeconds: number): string {
    return this.delivery.createMailToken(signRequestReference, purpose, ttlSeconds)
  }
}
