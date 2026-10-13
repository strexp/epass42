/**
 * CVCA role facade (M17).
 *
 * Composes the CVCA key lifecycle, DV issuance and terminal issuance behind the
 * single entry point consumed by the routes, the PKD directory and the DSC
 * personalization builder.
 */
import type { DvClass, DvPermissions } from '@epass42/shared'
import type { CvKeyPair, CvPublicKey } from '@epass42/pki'

import type {
  CvcaContext,
  CvcaKeyRow,
  DvApplicationRow,
  DvCertRow,
  TerminalCertRow,
} from './context'
import { CvcaKeyService, currentCvcaKey, type CvcaTrustAnchor } from './keys'
import { DvIssuanceService, currentDefaultDv, parsePermissions } from './dvIssuance'
import { activeOwnDv, mntDelegatesToDefaultDv } from '../mnt/dvDelegation'

export type {
  CvcaKeyRow,
  DvApplicationRow,
  DvCertRow,
  TerminalCertRow,
  CvcaContext,
} from './context'
export type { CvcaTrustAnchor } from './keys'
export { currentCvcaKey, currentDefaultDv, parsePermissions }

/** Parameters for issuing a terminal (Inspection System) certificate. */
export interface IssueTerminalParams {
  subjectCn: string | null
  holderMnemonic: string
  permissions?: DvPermissions
  validityDays: number
  mnt: string | null
  keyMode: 'remote_generated' | 'user_uploaded'
  publicKey?: CvPublicKey
}

/** CVCA service. */
export class CvcaService {
  readonly keys: CvcaKeyService
  readonly dvs: DvIssuanceService

  constructor(private readonly ctx: CvcaContext) {
    this.keys = new CvcaKeyService(ctx)
    this.dvs = new DvIssuanceService(ctx, this.keys)
  }

  /* Key lifecycle ------------------------------------------------------ */

  ensureCvcaKey(): Promise<CvcaKeyRow | undefined> {
    return this.keys.ensure()
  }

  bootstrapCvcaKey(): Promise<CvcaKeyRow> {
    return this.keys.bootstrap()
  }

  loadKeyPair(row: CvcaKeyRow): Promise<CvKeyPair> {
    return this.keys.loadKeyPair(row)
  }

  /** The current CVCA trust anchor (EC point, reference, grant), or undefined. */
  trustAnchor(): CvcaTrustAnchor | undefined {
    return this.keys.trustAnchor()
  }

  validateCurrentKey(): Promise<void> {
    return this.keys.validateCurrentKey()
  }

  rollover(): Promise<{ previous: CvcaKeyRow; link: CvcaKeyRow; next: CvcaKeyRow }> {
    return this.keys.rollover()
  }

  /* DV issuance -------------------------------------------------------- */

  approve(
    application: DvApplicationRow,
    adminAccountId: number | null,
    override?: { permissions?: DvPermissions; dvClass?: DvClass },
  ): Promise<DvCertRow> {
    return this.dvs.approve(application, adminAccountId, override)
  }

  reject(application: DvApplicationRow, adminAccountId: number | null, reason: string): void {
    this.dvs.reject(application, adminAccountId, reason)
  }

  exportDvPrivateKey(row: DvCertRow): string {
    return this.dvs.exportDvPrivateKey(row)
  }

  /** Ensures the CVCA-issued default (system) DV exists. */
  ensureDefaultDv(): Promise<DvCertRow | undefined> {
    return this.dvs.ensureDefaultDv()
  }

  /** The current default (system) DV certificate, or undefined. */
  defaultDv(): DvCertRow | undefined {
    return currentDefaultDv(this.ctx.db)
  }

  /**
   * Resolves which DV signs a maintainer's terminal certificates, following the
   * DV delegation: the maintainer's own active DV, or the CVCA default DV.
   */
  resolveDvSelection(mnt: string | null): DvCertRow | undefined {
    if (mnt !== null && !mntDelegatesToDefaultDv(this.ctx.db, mnt)) {
      const own = activeOwnDv(this.ctx.db, mnt)
      if (own) return own
    }
    return currentDefaultDv(this.ctx.db)
  }

  /* Terminal issuance -------------------------------------------------- */

  issueTerminal(dv: DvCertRow, params: IssueTerminalParams): Promise<TerminalCertRow> {
    return this.dvs.issueTerminal(dv, params)
  }

  exportTerminalPrivateKey(row: TerminalCertRow): string {
    return this.dvs.exportDvPrivateKey(row)
  }
}
