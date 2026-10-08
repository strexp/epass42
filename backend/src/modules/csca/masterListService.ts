/**
 * CSCA Master List generation (M10, Doc 9303-12 §9).
 *
 * A Master List Signer certificate (EKU id-icao-cscaMasterListSigningKey) is
 * created on demand and used to sign the Master List over every CSCA
 * certificate.
 */
import { and, desc, eq } from 'drizzle-orm'

import {
  buildMasterList,
  createMasterListSigner,
  generateRsaKeyPair,
  parseCertificatePem,
} from '@pkd42/pki'

import { cscaKey, dscCert, masterList } from '../../db/schema'
import { sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import { addYears, type CscaContext, type DscCertRow, type MasterListRow } from './context'
import type { CscaKeyService } from './keys'
import type { DscIssuanceService } from './dscIssuance'

/** Master List Signer and Master List generation. */
export class MasterListService {
  constructor(
    private readonly ctx: CscaContext,
    private readonly keys: CscaKeyService,
    private readonly dscIssuance: DscIssuanceService,
  ) {}

  /** The active Master List Signer certificate, or undefined. */
  currentSigner(): DscCertRow | undefined {
    return this.ctx.db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.source, 'ml-signer'), eq(dscCert.status, 'active')))
      .get()
  }

  /** Ensures a Master List Signer exists (EKU id-icao-cscaMasterListSigningKey). */
  async ensureSigner(): Promise<DscCertRow> {
    const existing = this.currentSigner()
    if (existing) return existing
    const { config, db, keks } = this.ctx
    const csca = await this.keys.ensure()
    if (!csca) throw new Error('no CSCA key available')
    const cscaPair = await this.keys.loadKeyPair(csca)
    const now = new Date()
    const key = await generateRsaKeyPair({ modulusLength: config.csca.niaDsc.keyBits, pss: false })
    const generated = await createMasterListSigner(
      {
        commonName: `${config.csca.commonName} ML Signer`,
        country: config.countryAlpha2,
        documentTypes: ['P'],
        notBefore: now,
        notAfter: addYears(now, config.csca.niaDsc.validityYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        pss: false,
      },
      key,
      { certificate: parseCertificatePem(csca.certPem), key: cscaPair },
    )
    const result = db
      .insert(dscCert)
      .values({
        cscaKeyId: csca.id,
        serial: generated.serialHex,
        subjectDn: generated.certificate.subject,
        mnt: null,
        source: 'ml-signer',
        certPem: generated.pem,
        keyRef: sealPrivateKey(key.pkcs8, keks[0]!),
        status: 'active',
        notBefore: generated.certificate.notBefore.toISOString(),
        notAfter: generated.certificate.notAfter.toISOString(),
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(dscCert)
      .where(eq(dscCert.id, Number(result.lastInsertRowid)))
      .get() as DscCertRow
  }

  /** The most recent Master List, or undefined. */
  latest(): MasterListRow | undefined {
    return this.ctx.db.select().from(masterList).orderBy(desc(masterList.id)).get()
  }

  /** Builds and stores a new CSCA Master List (Doc 9303-12 §9). */
  async generate(): Promise<MasterListRow> {
    const { db } = this.ctx
    const signer = await this.ensureSigner()
    const signerPair = await this.dscIssuance.loadDscKeyPair(signer)
    const cscaCertificates = db
      .select()
      .from(cscaKey)
      .all()
      .map((row) => new Uint8Array(parseCertificatePem(row.certPem).rawData))
    const der = await buildMasterList({
      cscaCertificates,
      signerCertificate: new Uint8Array(parseCertificatePem(signer.certPem).rawData),
      signerPrivateKey: signerPair.privateKey,
      signingTime: new Date(),
    })
    const result = db
      .insert(masterList)
      .values({
        signerDscId: signer.id,
        der: Buffer.from(der),
        publishedAt: nowIso(),
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(masterList)
      .where(eq(masterList.id, Number(result.lastInsertRowid)))
      .get() as MasterListRow
  }
}
