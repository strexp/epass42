/**
 * CSCA role facade (M5).
 *
 * Composes the focused services — key lifecycle, DSC issuance, CRL and Master
 * List — behind the single entry point consumed by the routes and the DSC
 * signing service.
 */
import type { RsaKeyPair } from '@epass42/pki'

import type {
  CscaContext,
  CscaKeyRow,
  CrlRow,
  DscApplicationRow,
  DscCertRow,
  MasterListRow,
} from './context'
import { CscaKeyService, currentCscaKey } from './keys'
import { DscIssuanceService, currentNiaDsc } from './dscIssuance'
import { CrlService } from './crlService'
import { MasterListService } from './masterListService'

export type { CscaKeyRow, DscCertRow, DscApplicationRow, CrlRow, CscaContext } from './context'
export { currentCscaKey, currentNiaDsc }

/** CSCA service. */
export class CscaService {
  readonly keys: CscaKeyService
  readonly dscIssuance: DscIssuanceService
  readonly crl: CrlService
  readonly masterList: MasterListService

  constructor(ctx: CscaContext) {
    this.keys = new CscaKeyService(ctx)
    this.dscIssuance = new DscIssuanceService(ctx, this.keys)
    this.crl = new CrlService(ctx, this.keys)
    this.masterList = new MasterListService(ctx, this.keys, this.dscIssuance)
  }

  /* Key lifecycle ------------------------------------------------------ */

  ensureCscaKey(): Promise<CscaKeyRow | undefined> {
    return this.keys.ensure()
  }

  bootstrapCscaKey(): Promise<CscaKeyRow> {
    return this.keys.bootstrap()
  }

  loadKeyPair(row: CscaKeyRow): Promise<RsaKeyPair> {
    return this.keys.loadKeyPair(row)
  }

  validateCurrentKey(): Promise<void> {
    return this.keys.validateCurrentKey()
  }

  /** Seals arbitrary bytes at rest with the envelope KEK. */
  seal(bytes: Uint8Array): string {
    return this.keys.seal(bytes)
  }

  /** Opens bytes sealed by {@link seal}. */
  open(sealed: string): Uint8Array {
    return this.keys.open(sealed)
  }

  rollover(): Promise<{ previous: CscaKeyRow; next: CscaKeyRow }> {
    return this.keys.rollover()
  }

  /* DSC issuance ------------------------------------------------------- */

  ensureNiaDsc(): Promise<DscCertRow | undefined> {
    return this.dscIssuance.ensureNiaDsc()
  }

  issueDsc(params: Parameters<DscIssuanceService['issueDsc']>[0]): Promise<DscCertRow> {
    return this.dscIssuance.issueDsc(params)
  }

  loadDscKeyPair(row: DscCertRow, pss = false): Promise<RsaKeyPair> {
    return this.dscIssuance.loadDscKeyPair(row, pss)
  }

  exportDscPrivateKey(row: DscCertRow): string {
    return this.dscIssuance.exportDscPrivateKey(row)
  }

  approve(application: DscApplicationRow, adminAccountId: number | null): Promise<DscCertRow> {
    return this.dscIssuance.approve(application, adminAccountId)
  }

  reject(application: DscApplicationRow, adminAccountId: number | null, reason: string): void {
    this.dscIssuance.reject(application, adminAccountId, reason)
  }

  revoke(certId: number, reason: string | null): DscCertRow | undefined {
    return this.dscIssuance.revoke(certId, reason)
  }

  /* CRL ---------------------------------------------------------------- */

  latestCrl(): CrlRow | undefined {
    return this.crl.latest()
  }

  crlSchedule(now?: Date): { issue: boolean; reason: string } {
    return this.crl.schedule(now)
  }

  generateCrl(now?: Date): Promise<CrlRow> {
    return this.crl.generate(now)
  }

  maybeGenerateCrl(now?: Date): Promise<CrlRow | undefined> {
    return this.crl.maybeGenerate(now)
  }

  /* Master List -------------------------------------------------------- */

  currentMasterListSigner(): DscCertRow | undefined {
    return this.masterList.currentSigner()
  }

  ensureMasterListSigner(): Promise<DscCertRow> {
    return this.masterList.ensureSigner()
  }

  latestMasterList(): MasterListRow | undefined {
    return this.masterList.latest()
  }

  generateMasterList(): Promise<MasterListRow> {
    return this.masterList.generate()
  }
}
