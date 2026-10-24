/**
 * CSCA role facade (M5).
 *
 * Composes the focused services — key lifecycle, DSC issuance and CRL — behind
 * the single entry point consumed by the routes and the DSC signing service.
 */
import type { CertKeyPair, HashName } from '@epass42/pki'

import type { CscaContext, CscaKeyRow, CrlRow, DscApplicationRow, DscCertRow } from './context'
import { CscaKeyService, currentCscaKey } from './keys'
import { DscIssuanceService, currentNiaDsc } from './dscIssuance'
import { CrlService } from './crlService'
import { effectiveValidity } from '../../util/certificate'

export type { CscaKeyRow, DscCertRow, DscApplicationRow, CrlRow, CscaContext } from './context'
export { currentCscaKey, currentNiaDsc }

/** CSCA service. */
export class CscaService {
  readonly keys: CscaKeyService
  readonly dscIssuance: DscIssuanceService
  readonly crl: CrlService

  constructor(private readonly ctx: CscaContext) {
    this.keys = new CscaKeyService(ctx)
    this.dscIssuance = new DscIssuanceService(ctx, this.keys)
    this.crl = new CrlService(ctx, this.keys)
  }

  /** Whether the current CSCA certificate may issue new signer certificates. */
  canIssueCertificates(): boolean {
    const csca = currentCscaKey(this.ctx.db)
    return Boolean(
      csca &&
      !effectiveValidity({ format: 'x509', notAfter: csca.notAfter, certPem: csca.certPem })
        .expired,
    )
  }

  /** Whether a usable (existing, unexpired) NIA DSC is available. */
  hasUsableNiaDsc(): boolean {
    const nia = currentNiaDsc(this.ctx.db)
    if (!nia) return false
    const csca = currentCscaKey(this.ctx.db)
    return !effectiveValidity({
      format: 'x509',
      notAfter: nia.notAfter,
      certPem: nia.certPem,
      parentNotAfter: csca?.notAfter,
    }).expired
  }

  /* Key lifecycle ------------------------------------------------------ */

  ensureCscaKey(): Promise<CscaKeyRow | undefined> {
    return this.keys.ensure()
  }

  bootstrapCscaKey(): Promise<CscaKeyRow> {
    return this.keys.bootstrap()
  }

  loadKeyPair(row: CscaKeyRow, hash?: HashName): Promise<CertKeyPair> {
    return this.keys.loadKeyPair(row, hash)
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

  /** Manually rotates the NIA DSC, retiring the previous active one. */
  rotateNiaDsc(): Promise<{ previous: DscCertRow | null; current: DscCertRow }> {
    return this.dscIssuance.rotateNiaDsc()
  }

  issueDsc(params: Parameters<DscIssuanceService['issueDsc']>[0]): Promise<DscCertRow> {
    return this.dscIssuance.issueDsc(params)
  }

  issueLds2Signer(
    params: Parameters<DscIssuanceService['issueLds2Signer']>[0],
  ): Promise<DscCertRow> {
    return this.dscIssuance.issueLds2Signer(params)
  }

  loadDscKeyPair(row: DscCertRow, hash?: HashName): Promise<CertKeyPair> {
    return this.dscIssuance.loadDscKeyPair(row, hash)
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

  /** The latest CRL of the current CSCA key. */
  latestCrl(): CrlRow | undefined {
    return this.crl.latestForCurrentKey()
  }

  /** The latest CRL issued by a specific CSCA key. */
  latestCrlForKey(cscaKeyId: number): CrlRow | undefined {
    return this.crl.latestForKey(cscaKeyId)
  }

  crlSchedule(now?: Date): { issue: boolean; reason: string } {
    return this.crl.schedule(now)
  }

  generateCrl(now?: Date): Promise<CrlRow> {
    return this.crl.generate(now)
  }

  /** Regenerates the CRL for the CSCA key that issued a certificate. */
  generateCrlForKey(cscaKeyId: number, now?: Date): Promise<CrlRow> {
    return this.crl.generateForKeyId(cscaKeyId, now)
  }

  maybeGenerateCrl(now?: Date): Promise<CrlRow[]> {
    return this.crl.maybeGenerate(now)
  }
}
