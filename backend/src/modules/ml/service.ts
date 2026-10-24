/**
 * Master List role facade.
 *
 * Composes the signer lifecycle and master-list generation behind the single
 * entry point consumed by the ML routes and the backend entrypoint.
 */
import { certificateValidity } from '../../util/certificate'
import { currentCscaKey, type CscaService } from '../csca/service'
import type { MasterListRow, MlContext, MlSignerRow } from './context'
import { MlMasterListService } from './masterList'
import { MlSignerService, signerMetadata, type MlSignerMetadata } from './signers'

export type { MasterListRow, MlSignerRow } from './context'
export type { MlSignerMetadata } from './signers'

/** The ML lifecycle status returned to the administrator UI. */
export interface MlStatus {
  signer: (MlSignerMetadata & ReturnType<typeof certificateValidity>) | null
  latestMasterList: {
    id: number
    objectId: string
    publishedAt: string | null
    signerId: number | null
    signerSerial: string | null
    signerStatus: string | null
    signerExpired: boolean | null
  } | null
  canGenerateMasterList: boolean
  canRotateSigner: boolean
  csca: {
    id: number
    serial: string
    status: string
    notAfter: string | null
    expired: boolean
    daysRemaining: number | null
  } | null
}

/** Master List service. */
export class MlService {
  readonly signers: MlSignerService
  readonly masterLists: MlMasterListService

  constructor(
    private readonly ctx: MlContext,
    csca: CscaService,
  ) {
    this.signers = new MlSignerService(ctx, csca)
    this.masterLists = new MlMasterListService(ctx, this.signers)
  }

  /** The active ML Signer, or undefined. */
  currentSigner(): MlSignerRow | undefined {
    return this.signers.current()
  }

  /** Metadata for a signer row (fingerprint and validity fields). */
  signerMetadata(row: MlSignerRow): MlSignerMetadata {
    return signerMetadata(row)
  }

  /** Ensures the configured bootstrap signer exists. */
  ensureSigner(): Promise<MlSignerRow | undefined> {
    return this.signers.ensure()
  }

  /** Manually creates or rotates the ML Signer. */
  rotateSigner(): Promise<{ previous: MlSignerRow | null; current: MlSignerRow }> {
    return this.signers.rotate()
  }

  /** The most recent master list. */
  latestMasterList(): MasterListRow | undefined {
    return this.masterLists.latest()
  }

  /** Builds and publishes a new master list. */
  generateMasterList(): Promise<MasterListRow> {
    return this.masterLists.generate()
  }

  /** The signer/master-list lifecycle summary used by the ML UI. */
  status(): MlStatus {
    const signer = this.signers.current()
    const signerValidity = signer ? certificateValidity(signer.notAfter) : null
    const latest = this.masterLists.latest()
    const latestSigner = latest?.signerDscId ? this.signers.byId(latest.signerDscId) : undefined
    const latestSignerValidity = latestSigner ? certificateValidity(latestSigner.notAfter) : null
    const csca = currentCscaKey(this.ctx.db)
    const cscaValidity = csca ? certificateValidity(csca.notAfter) : null

    return {
      signer: signer && signerValidity ? { ...signerMetadata(signer), ...signerValidity } : null,
      latestMasterList: latest
        ? {
            id: latest.id,
            objectId: `ml-${latest.id}`,
            publishedAt: latest.publishedAt,
            signerId: latestSigner?.id ?? latest.signerDscId ?? null,
            signerSerial: latestSigner?.serial ?? null,
            signerStatus: latestSigner?.status ?? null,
            signerExpired: latestSignerValidity?.expired ?? null,
          }
        : null,
      canGenerateMasterList: Boolean(signer && signerValidity && !signerValidity.expired),
      canRotateSigner: Boolean(csca && cscaValidity && !cscaValidity.expired),
      csca: csca
        ? {
            id: csca.id,
            serial: csca.serial,
            status: csca.status,
            notAfter: csca.notAfter,
            expired: cscaValidity?.expired ?? true,
            daysRemaining: cscaValidity?.daysRemaining ?? null,
          }
        : null,
    }
  }
}
