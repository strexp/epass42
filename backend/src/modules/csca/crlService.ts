/**
 * CRL generation and scheduling (M6, extended for CSCA key rollover).
 *
 * Every CSCA certificate that has ever signed a DSC can publish its own CRL.
 * A CRL is signed by the key of the CSCA certificate that issued the listed
 * DSCs, so a rollover does not orphan the revocation entries of certificates
 * issued under the previous key.  CRL numbers are allocated from one global
 * sequence: monotonic per issuer, and unique for the PKD/LDAP `cn`.
 */
import { and, desc, eq, ne } from 'drizzle-orm'

import { createCrl, parseCertificatePem, type HashName } from '@epass42/pki'
import { AppError } from '@epass42/shared'

import { crl, cscaKey, dscCert } from '../../db/schema'
import { nowIso } from '../../util/time'
import { effectiveValidity } from '../../util/certificate'
import type { CscaContext, CscaKeyRow, CrlRow } from './context'
import type { CscaKeyService } from './keys'
import { currentCscaKey } from './keys'

/** The reason a CRL should be issued. */
export interface CrlSchedule {
  issue: boolean
  reason: string
}

/** CRL generation and schedule evaluation. */
export class CrlService {
  constructor(
    private readonly ctx: CscaContext,
    private readonly keys: CscaKeyService,
  ) {}

  /** The most recently generated CRL across all CSCA keys (number allocation). */
  latest(): CrlRow | undefined {
    return this.ctx.db.select().from(crl).orderBy(desc(crl.crlNumber)).get()
  }

  /** The most recent CRL issued by a specific CSCA key. */
  latestForKey(cscaKeyId: number): CrlRow | undefined {
    return this.ctx.db
      .select()
      .from(crl)
      .where(eq(crl.cscaKeyId, cscaKeyId))
      .orderBy(desc(crl.crlNumber))
      .get()
  }

  /** The most recent CRL issued by the current CSCA key. */
  latestForCurrentKey(): CrlRow | undefined {
    const current = currentCscaKey(this.ctx.db)
    return current ? this.latestForKey(current.id) : this.latest()
  }

  /**
   * The CSCA certificates that can publish a CRL.  Link certificates share the
   * successor key and are not issuing CAs, so they are excluded.
   */
  private issuingKeys(): CscaKeyRow[] {
    return this.ctx.db
      .select()
      .from(cscaKey)
      .where(ne(cscaKey.status, 'link'))
      .orderBy(cscaKey.id)
      .all()
  }

  /**
   * Whether this CSCA key needs a fresh CRL: no CRL yet, a revocation post-dates
   * the last one, it is older than the maximum age, or the minimum refresh
   * interval has elapsed.
   */
  scheduleForKey(key: CscaKeyRow, now: Date = new Date()): CrlSchedule {
    // A CRL cannot be signed after the CA certificate or its key period ends.
    if (
      effectiveValidity({ format: 'x509', notAfter: key.notAfter, certPem: key.certPem }, now)
        .expired
    ) {
      return { issue: false, reason: 'expired' }
    }
    const last = this.latestForKey(key.id)
    if (!last) return { issue: true, reason: 'none' }
    const revoked = this.ctx.db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.cscaKeyId, key.id), eq(dscCert.status, 'revoked')))
      .all()
    const lastTime = new Date(last.thisUpdate).getTime()
    if (revoked.some((row) => row.revokedAt && new Date(row.revokedAt).getTime() > lastTime)) {
      return { issue: true, reason: 'revocation' }
    }
    const ageMs = now.getTime() - lastTime
    if (ageMs >= this.ctx.config.crl.maxAgeDays * 86_400_000)
      return { issue: true, reason: 'max-age' }
    if (ageMs >= this.ctx.config.crl.minIntervalHours * 3_600_000)
      return { issue: true, reason: 'refresh' }
    return { issue: false, reason: 'fresh' }
  }

  /**
   * Whether any CSCA key needs a fresh CRL.  This is the aggregate view used by
   * the admin status endpoint and the existing single-CRL tests; the scheduler
   * regenerates each due key independently.
   */
  schedule(now: Date = new Date()): CrlSchedule {
    const keys = this.issuingKeys()
    if (keys.length === 0) return { issue: false, reason: 'none' }
    for (const key of keys) {
      const result = this.scheduleForKey(key, now)
      if (result.issue) return result
    }
    return { issue: false, reason: 'fresh' }
  }

  /**
   * Generates a CRL for one CSCA key, covering exactly the DSCs revoked under
   * that key.  The global CRL number stays unique for PKD/LDAP entry names.
   */
  async generateForKey(key: CscaKeyRow, now: Date = new Date()): Promise<CrlRow> {
    if (key.status === 'link') throw new Error('a link certificate does not issue a CRL')
    if (
      effectiveValidity({ format: 'x509', notAfter: key.notAfter, certPem: key.certPem }, now)
        .expired
    ) {
      throw new AppError(
        'csca_expired',
        'the CSCA certificate or its private key has expired; a CRL cannot be signed',
        409,
      )
    }
    const { db } = this.ctx
    const keyPair = await this.keys.loadKeyPair(key, this.ctx.config.csca.hash as HashName)
    const issuerCertificate = parseCertificatePem(key.certPem)
    const revoked = db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.cscaKeyId, key.id), eq(dscCert.status, 'revoked')))
      .all()
    const crlNumber = (this.latest()?.crlNumber ?? 0) + 1
    const nextUpdate = new Date(now.getTime() + this.ctx.config.crl.maxAgeDays * 86_400_000)

    const generated = await createCrl({
      issuerCertificate,
      signingKey: keyPair,
      crlNumber,
      thisUpdate: now,
      nextUpdate,
      entries: revoked
        .filter((row) => row.revokedAt !== null)
        .map((row) => ({
          serialHex: row.serial,
          revocationDate: new Date(row.revokedAt as string),
        })),
      hash: this.ctx.config.csca.hash as HashName,
    })
    const result = db
      .insert(crl)
      .values({
        cscaKeyId: key.id,
        crlNumber,
        thisUpdate: now.toISOString(),
        nextUpdate: nextUpdate.toISOString(),
        der: Buffer.from(generated.der),
        published: true,
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(crl)
      .where(eq(crl.id, Number(result.lastInsertRowid)))
      .get() as CrlRow
  }

  /** Generates a CRL for the current CSCA key (kept for the existing API). */
  async generate(now: Date = new Date()): Promise<CrlRow> {
    const csca = await this.keys.ensure()
    if (!csca) throw new Error('no CSCA key available')
    return this.generateForKey(csca, now)
  }

  /** Generates a CRL for a CSCA key id. */
  async generateForKeyId(cscaKeyId: number, now: Date = new Date()): Promise<CrlRow> {
    const key = this.ctx.db.select().from(cscaKey).where(eq(cscaKey.id, cscaKeyId)).get()
    if (!key) throw new Error('CSCA key not found')
    return this.generateForKey(key, now)
  }

  /** Generates a fresh CRL for every issuing CSCA key that is due. */
  async generateDue(now: Date = new Date()): Promise<CrlRow[]> {
    const generated: CrlRow[] = []
    for (const key of this.issuingKeys()) {
      if (this.scheduleForKey(key, now).issue) generated.push(await this.generateForKey(key, now))
    }
    return generated
  }

  /** Generates due CRLs only when automatic generation is enabled. */
  async maybeGenerate(now: Date = new Date()): Promise<CrlRow[]> {
    if (!this.ctx.config.crl.autoGenerate) return []
    return this.generateDue(now)
  }
}
