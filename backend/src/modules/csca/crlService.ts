/**
 * CRL generation and scheduling (M6).
 *
 * A CRL is generated with a monotonically increasing number covering every DSC
 * revoked under the current CSCA key.
 */
import { and, desc, eq } from 'drizzle-orm'

import { createCrl, parseCertificatePem, type HashName } from '@epass42/pki'

import { crl, dscCert } from '../../db/schema'
import { nowIso } from '../../util/time'
import type { CscaContext, CrlRow } from './context'
import type { CscaKeyService } from './keys'
import { currentCscaKey } from './keys'

/** CRL generation and schedule evaluation. */
export class CrlService {
  constructor(
    private readonly ctx: CscaContext,
    private readonly keys: CscaKeyService,
  ) {}

  /** The most recently generated CRL, or undefined. */
  latest(): CrlRow | undefined {
    return this.ctx.db.select().from(crl).orderBy(desc(crl.crlNumber)).get()
  }

  /**
   * Whether a CRL should be issued now (M6/T6.3):
   * none exists, a revocation post-dates the last CRL, the last CRL is older
   * than the maximum age, or the minimum refresh interval has elapsed.
   */
  schedule(now: Date = new Date()): { issue: boolean; reason: string } {
    const last = this.latest()
    if (!last) return { issue: true, reason: 'none' }
    const csca = currentCscaKey(this.ctx.db)
    const revoked = csca
      ? this.ctx.db
          .select()
          .from(dscCert)
          .where(and(eq(dscCert.cscaKeyId, csca.id), eq(dscCert.status, 'revoked')))
          .all()
      : []
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
   * Generates a fresh CRL with a monotonically increasing number, covering all
   * DSCs revoked under the current CSCA key.
   */
  async generate(now: Date = new Date()): Promise<CrlRow> {
    const { db } = this.ctx
    const csca = await this.keys.ensure()
    if (!csca) throw new Error('no CSCA key available')
    const keyPair = await this.keys.loadKeyPair(csca, this.ctx.config.csca.hash as HashName)
    const issuerCertificate = parseCertificatePem(csca.certPem)
    const revoked = db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.cscaKeyId, csca.id), eq(dscCert.status, 'revoked')))
      .all()
    const last = this.latest()
    const crlNumber = (last?.crlNumber ?? 0) + 1
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
        cscaKeyId: csca.id,
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

  /** Generates a CRL only when the schedule says one is due. */
  async maybeGenerate(now: Date = new Date()): Promise<CrlRow | undefined> {
    if (!this.ctx.config.crl.autoGenerate) return undefined
    return this.schedule(now).issue ? this.generate(now) : undefined
  }
}
