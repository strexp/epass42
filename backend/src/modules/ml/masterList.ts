/**
 * CSCA Master List generation (Doc 9303-12 §9).
 *
 * The master list is a CMS SignedData over every CSCA certificate, signed by
 * the active ML Signer.  Public listing and download stay in the PKD module;
 * this service only owns generation and the latest-row lookup.
 */
import { desc, eq } from 'drizzle-orm'

import { buildMasterList, parseCertificatePem, type HashName } from '@epass42/pki'
import { AppError } from '@epass42/shared'

import { cscaKey, masterList } from '../../db/schema'
import { certificateValidity } from '../../util/certificate'
import { nowIso } from '../../util/time'
import type { MasterListRow, MlContext } from './context'
import type { MlSignerService } from './signers'

/** Master List generation. */
export class MlMasterListService {
  constructor(
    private readonly ctx: MlContext,
    private readonly signers: MlSignerService,
  ) {}

  /** The most recent master list, or undefined. */
  latest(): MasterListRow | undefined {
    return this.ctx.db.select().from(masterList).orderBy(desc(masterList.id)).get()
  }

  /** Builds and stores a new master list with the active ML Signer. */
  async generate(): Promise<MasterListRow> {
    const signer = this.signers.current()
    if (!signer) {
      throw new AppError('ml_signer_missing', 'no active ML signer; create one first', 409)
    }
    if (certificateValidity(signer.notAfter).expired) {
      throw new AppError(
        'ml_signer_expired',
        'the active ML signer has expired; rotate it first',
        409,
      )
    }

    const signerPair = await this.signers.loadKeyPair(signer)
    const cscaCertificates = this.ctx.db
      .select()
      .from(cscaKey)
      .all()
      .map((row) => new Uint8Array(parseCertificatePem(row.certPem).rawData))
    const der = await buildMasterList({
      cscaCertificates,
      signerCertificate: new Uint8Array(parseCertificatePem(signer.certPem).rawData),
      signerPrivateKey: signerPair.privateKey,
      hash: this.ctx.config.ml.signer.hash as HashName,
      signingTime: new Date(),
    })

    const result = this.ctx.db
      .insert(masterList)
      .values({
        signerDscId: signer.id,
        der: Buffer.from(der),
        publishedAt: nowIso(),
        createdAt: nowIso(),
      })
      .run()
    return this.ctx.db
      .select()
      .from(masterList)
      .where(eq(masterList.id, Number(result.lastInsertRowid)))
      .get() as MasterListRow
  }
}
