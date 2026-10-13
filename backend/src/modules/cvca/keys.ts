/**
 * CVCA key lifecycle (M17): bootstrap, sealing/opening and rollover of the
 * online Country Verifying CA key pair (Doc 9303-12 §4.2).
 *
 * An ECDSA (P-256) CVCA is required for Terminal Authentication: its public
 * point is personalized into the card as a CVCA trust point.
 */
import { eq } from 'drizzle-orm'

import type { DvPermissions } from '@epass42/shared'
import {
  certificateReference,
  createCvcaLink,
  createCvcaRoot,
  generateEcKeyPair,
  generateRsaKeyPair,
  importEcKeyPair,
  importRsaKeyPair,
  isEcKey,
  parseCvCertificate,
  type CvKeyPair,
  type GeneratedCvCertificate,
  type HashName,
} from '@epass42/pki'

import { cvcaKey } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import { addMonths, sequenceNumber, type CvcaContext, type CvcaKeyRow } from './context'

/** The current (active) CVCA key row, or undefined. */
export function currentCvcaKey(db: CvcaContext['db']): CvcaKeyRow | undefined {
  return db.select().from(cvcaKey).where(eq(cvcaKey.isCurrent, true)).get()
}

/** A CVCA trust anchor for Terminal Authentication personalization. */
export interface CvcaTrustAnchor {
  /** Certification Authority Reference. */
  car: string
  /** Effective Date, `YYMMDD`. */
  effective: string
  /** The CVCA grant (trust-point authorization). */
  authorization: DvPermissions
  /** EC: uncompressed public point (`04 || X || Y`). */
  publicKey?: Uint8Array
  /** RSA-PSS: modulus and exponent. */
  modulus?: Uint8Array
  exponent?: Uint8Array
}

/** The online CVCA key: bootstrap, store, open and roll over. */
export class CvcaKeyService {
  constructor(private readonly ctx: CvcaContext) {}

  /** Returns the current key, bootstrapping a self-signed CVCA when allowed. */
  async ensure(): Promise<CvcaKeyRow | undefined> {
    const existing = currentCvcaKey(this.ctx.db)
    if (existing) return existing
    if (!this.ctx.config.cvca.bootstrap) return undefined
    return this.bootstrap()
  }

  /** Generates the configured key pair (ECDSA P-256 or RSA-PSS). */
  private generate(): Promise<CvKeyPair> {
    const { config } = this.ctx
    if (config.cvca.algorithm === 'ecdsa') return generateEcKeyPair()
    // The CV RSA profile is RSA-PSS-SHA-256 (id-TA-RSA-PSS-SHA-256).
    return generateRsaKeyPair({
      modulusLength: config.cvca.keyBits,
      pss: true,
      hash: 'SHA-256',
    })
  }

  /** Generates and stores a new self-signed CVCA root. */
  async bootstrap(): Promise<CvcaKeyRow> {
    const key = await this.generate()
    const generated = await createCvcaRoot(this.profile(new Date(), this.allocateSequence()), key)
    return this.store(generated, key, true, 'current')
  }

  /** The common CVCA profile shared by the root and its link certificate. */
  private profile(notBefore: Date, sequence: string) {
    const { config } = this.ctx
    return {
      country: config.countryAlpha2,
      holderMnemonic: config.cvca.holderMnemonic,
      sequence,
      role: 'cvca' as const,
      permissions: config.cvca.authorization,
      notBefore,
      notAfter: addMonths(notBefore, config.cvca.validityMonths),
    }
  }

  /** Allocates an unused five-character sequence number for the holder mnemonic. */
  private allocateSequence(): string {
    const { config, db } = this.ctx
    const used = new Set(
      db
        .select()
        .from(cvcaKey)
        .all()
        .map((row) => row.holderReference),
    )
    let index = 1
    while (
      used.has(
        certificateReference(
          config.countryAlpha2,
          config.cvca.holderMnemonic,
          sequenceNumber(config.countryAlpha2, index),
        ),
      )
    ) {
      index += 1
    }
    return sequenceNumber(config.countryAlpha2, index)
  }

  private store(
    generated: GeneratedCvCertificate,
    key: CvKeyPair,
    current: boolean,
    status: string,
  ): CvcaKeyRow {
    const { db, keks } = this.ctx
    if (current) db.update(cvcaKey).set({ isCurrent: false }).run()
    const keyAlgorithm = isEcKey(key) ? 'ECDSA' : key.pss ? 'RSASSA-PSS' : 'RSASSA-PKCS1-v1_5'
    const result = db
      .insert(cvcaKey)
      .values({
        holderReference: generated.holderReference,
        fingerprintSha256: generated.fingerprintSha256,
        authorityReference: generated.authorityReference,
        subjectCn: this.ctx.config.cvca.commonName,
        keyAlgorithm,
        certDer: Buffer.from(generated.der),
        keyRef: sealPrivateKey(key.pkcs8, keks[0]!),
        status,
        isCurrent: current,
        notBefore: generated.effectiveDate.toISOString(),
        notAfter: generated.expirationDate.toISOString(),
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(cvcaKey)
      .where(eq(cvcaKey.id, Number(result.lastInsertRowid)))
      .get() as CvcaKeyRow
  }

  /** Opens the CVCA private key for signing. */
  async loadKeyPair(row: CvcaKeyRow): Promise<CvKeyPair> {
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    if (row.keyAlgorithm === 'ECDSA') {
      const parsed = parseCvCertificate(new Uint8Array(row.certDer))
      if (parsed.publicKey.algorithm !== 'ec') throw new Error('CVCA certificate is not EC')
      return importEcKeyPair(pkcs8, parsed.publicKey.point)
    }
    return importRsaKeyPair(
      pkcs8,
      row.keyAlgorithm === 'RSASSA-PSS',
      this.ctx.config.cvca.hash as HashName,
    )
  }

  /** Loads the current CVCA key pair, throwing on a KEK mismatch. */
  async validateCurrentKey(): Promise<void> {
    const current = currentCvcaKey(this.ctx.db)
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

  /** The current CVCA trust anchor (key, reference, grant), or undefined. */
  trustAnchor(): CvcaTrustAnchor | undefined {
    const row = currentCvcaKey(this.ctx.db)
    if (!row) return undefined
    const parsed = parseCvCertificate(new Uint8Array(row.certDer))
    const date = parsed.effectiveDate
    const effective = `${String(date.getUTCFullYear() % 100).padStart(2, '0')}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
    const base = {
      car: row.holderReference,
      effective,
      authorization: this.ctx.config.cvca.authorization,
    }
    if (parsed.publicKey.algorithm === 'ec') {
      return { ...base, publicKey: parsed.publicKey.point }
    }
    return {
      ...base,
      modulus: parsed.publicKey.modulus,
      exponent: parsed.publicKey.publicExponent,
    }
  }

  /**
   * Rolls the CVCA key over, emitting a link certificate signed by the old key.
   * The old key is retired; the link and the new self-signed root share the new
   * Certificate Holder Reference.
   */
  async rollover(): Promise<{ previous: CvcaKeyRow; link: CvcaKeyRow; next: CvcaKeyRow }> {
    const db = this.ctx.db
    const previous = currentCvcaKey(db)
    if (!previous) throw new Error('no current CVCA key to roll over')
    const previousPair = await this.loadKeyPair(previous)

    const now = new Date()
    const newPair = await this.generate()
    const sequence = this.allocateSequence()
    const profile = this.profile(now, sequence)

    const link = await createCvcaLink(
      { holderReference: previous.holderReference, key: previousPair },
      profile,
      newPair,
    )
    db.update(cvcaKey).set({ isCurrent: false, status: 'retired' }).run()
    const linkRow = this.store(link, newPair, false, 'link')

    const generated = await createCvcaRoot(profile, newPair)
    const next = this.store(generated, newPair, true, 'current')
    return { previous, link: linkRow, next }
  }

  /** Parses the CV certificate of a stored key row. */
  parse(row: CvcaKeyRow) {
    return parseCvCertificate(new Uint8Array(row.certDer))
  }
}
