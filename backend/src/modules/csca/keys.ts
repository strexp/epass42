/**
 * CSCA key lifecycle (M5): bootstrap, sealing/opening and rollover of the
 * online Country Signing CA key pair.
 */
import { eq } from 'drizzle-orm'

import {
  createCscaLink,
  createCscaRoot,
  generateRsaKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  type GeneratedCertificate,
  type HashName,
  type RsaKeyPair,
} from '@epass42/pki'

import { cscaKey } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import { addYears, type CscaContext, type CscaKeyRow } from './context'

/** The current (active) CSCA key row, or undefined. */
export function currentCscaKey(db: CscaContext['db']): CscaKeyRow | undefined {
  return db.select().from(cscaKey).where(eq(cscaKey.isCurrent, true)).get()
}

/** The online CSCA key: bootstrap, store, open and roll over. */
export class CscaKeyService {
  constructor(private readonly ctx: CscaContext) {}

  /** Returns the current key, bootstrapping a self-signed CSCA when allowed. */
  async ensure(): Promise<CscaKeyRow | undefined> {
    const existing = currentCscaKey(this.ctx.db)
    if (existing) return existing
    if (!this.ctx.config.csca.bootstrap) return undefined
    return this.bootstrap()
  }

  /** Generates and stores a new self-signed CSCA root. */
  async bootstrap(): Promise<CscaKeyRow> {
    const { config } = this.ctx
    const now = new Date()
    const key = await generateRsaKeyPair({
      modulusLength: config.csca.keyBits,
      pss: config.csca.pss,
      hash: config.csca.hash as HashName,
    })
    const generated = await createCscaRoot(
      {
        commonName: config.csca.commonName,
        organization: config.csca.organization,
        locality: config.csca.locality,
        country: config.countryAlpha2,
        notBefore: now,
        notAfter: addYears(now, config.csca.validityYears),
        privateKeyNotAfter: addYears(now, config.csca.privateKeyUsageYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        pss: config.csca.pss,
        hash: config.csca.hash as HashName,
      },
      key,
    )
    return this.store(generated, key, true)
  }

  private store(generated: GeneratedCertificate, key: RsaKeyPair, current: boolean): CscaKeyRow {
    const { db, keks } = this.ctx
    if (current) db.update(cscaKey).set({ isCurrent: false }).run()
    const result = db
      .insert(cscaKey)
      .values({
        serial: generated.serialHex,
        subjectDn: generated.certificate.subject,
        keyAlgorithm: key.pss ? 'RSASSA-PSS' : 'RSASSA-PKCS1-v1_5',
        notBefore: generated.certificate.notBefore.toISOString(),
        notAfter: generated.certificate.notAfter.toISOString(),
        certPem: generated.pem,
        keyRef: sealPrivateKey(key.pkcs8, keks[0]!),
        isCurrent: current,
        status: 'active',
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(cscaKey)
      .where(eq(cscaKey.id, Number(result.lastInsertRowid)))
      .get() as CscaKeyRow
  }

  /** Opens the CSCA private key for signing. */
  async loadKeyPair(row: CscaKeyRow): Promise<RsaKeyPair> {
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    return importRsaKeyPair(pkcs8, row.keyAlgorithm === 'RSASSA-PSS')
  }

  /** Loads the current CSCA key pair, throwing on a KEK mismatch. */
  async validateCurrentKey(): Promise<void> {
    const current = currentCscaKey(this.ctx.db)
    if (current) await this.loadKeyPair(current)
  }

  /** Seals arbitrary bytes at rest with the envelope KEK. */
  seal(bytes: Uint8Array): string {
    return sealPrivateKey(bytes, this.ctx.keks[0]!)
  }

  /** Opens bytes sealed by {@link seal}. */
  open(sealed: string): Uint8Array {
    return openPrivateKey(sealed, this.ctx.keks)
  }

  /** Rolls the CSCA key over, emitting a link certificate signed by the old key. */
  async rollover(): Promise<{ previous: CscaKeyRow; next: CscaKeyRow }> {
    const { config } = this.ctx
    const previous = currentCscaKey(this.ctx.db)
    if (!previous) throw new Error('no current CSCA key to roll over')
    const previousPair = await this.loadKeyPair(previous)
    const previousCert = parseCertificatePem(previous.certPem)

    const now = new Date()
    const newPair = await generateRsaKeyPair({
      modulusLength: config.csca.keyBits,
      pss: config.csca.pss,
      hash: config.csca.hash as HashName,
    })
    const link = await createCscaLink(
      previousCert,
      previousPair,
      {
        commonName: config.csca.commonName,
        organization: config.csca.organization,
        country: config.countryAlpha2,
        locality: config.csca.locality,
        notBefore: now,
        notAfter: addYears(now, config.csca.validityYears),
        privateKeyNotAfter: addYears(now, config.csca.privateKeyUsageYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        pss: config.csca.pss,
        hash: config.csca.hash as HashName,
      },
      newPair.publicKey,
      newPair.pss,
    )

    // Retire the old key, store the link certificate (non-current), then make
    // the new self-signed root current.
    this.ctx.db.update(cscaKey).set({ isCurrent: false, status: 'retired' }).run()
    const linkRow = this.store(link, newPair, false)
    this.ctx.db.update(cscaKey).set({ status: 'link' }).where(eq(cscaKey.id, linkRow.id)).run()

    const generated = await createCscaRoot(
      {
        commonName: config.csca.commonName,
        organization: config.csca.organization,
        locality: config.csca.locality,
        country: config.countryAlpha2,
        notBefore: now,
        notAfter: addYears(now, config.csca.validityYears),
        privateKeyNotAfter: addYears(now, config.csca.privateKeyUsageYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        pss: config.csca.pss,
        hash: config.csca.hash as HashName,
      },
      newPair,
    )
    const next = this.store(generated, newPair, true)
    return { previous, next }
  }
}
