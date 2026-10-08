/**
 * CSCA role service (M5): the online CSCA key, Document Signer issuance,
 * revocation, listing and key rollover.
 *
 * The CSCA private key is sealed with the envelope KEK and only opened while
 * issuing.  Issued NIA DSC private keys are sealed the same way so the DSC
 * signing service (M7) can sign EF.SOD.
 */
import * as pkijs from 'pkijs'
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '@pkd42/shared'

import {
  createCrl,
  createCscaLink,
  createCscaRoot,
  createDsc,
  createMasterListSigner,
  buildMasterList,
  derToPem,
  generateRsaKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  toArrayBuffer,
  type GeneratedCertificate,
  type HashName,
  type RsaKeyPair,
  type SubjectPublicKey,
} from '@pkd42/pki'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { crl, cscaKey, dscApplication, dscCert, masterList } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'

export type CscaKeyRow = typeof cscaKey.$inferSelect
export type DscCertRow = typeof dscCert.$inferSelect
export type DscApplicationRow = typeof dscApplication.$inferSelect
export type CrlRow = typeof crl.$inferSelect

/** Collaborators for the CSCA service. */
export interface CscaContext {
  db: Db
  config: AppConfig
  /** Ordered KEKs: index 0 seals new keys, all are tried when opening. */
  keks: Buffer[]
}

function addYears(date: Date, years: number): Date {
  const out = new Date(date)
  out.setUTCFullYear(out.getUTCFullYear() + years)
  return out
}

/** The current (active) CSCA key row, or undefined. */
export function currentCscaKey(db: Db): CscaKeyRow | undefined {
  return db.select().from(cscaKey).where(eq(cscaKey.isCurrent, true)).get()
}

/** The active NIA Document Signer certificate, or undefined. */
export function currentNiaDsc(db: Db): DscCertRow | undefined {
  return db
    .select()
    .from(dscCert)
    .where(and(eq(dscCert.source, 'nia'), eq(dscCert.status, 'active')))
    .get()
}

/** CSCA service. */
export class CscaService {
  constructor(private readonly ctx: CscaContext) {}

  /** Returns the current key, bootstrapping a self-signed CSCA when allowed. */
  async ensureCscaKey(): Promise<CscaKeyRow | undefined> {
    const existing = currentCscaKey(this.ctx.db)
    if (existing) return existing
    if (!this.ctx.config.csca.bootstrap) return undefined
    return this.bootstrapCscaKey()
  }

  /** Generates and stores a new self-signed CSCA root. */
  async bootstrapCscaKey(): Promise<CscaKeyRow> {
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
    return this.storeCscaKey(generated, key, true)
  }

  private storeCscaKey(
    generated: GeneratedCertificate,
    key: RsaKeyPair,
    current: boolean,
  ): CscaKeyRow {
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

  /** Ensures an active NIA DSC exists (creating one signed by the CSCA). */
  async ensureNiaDsc(): Promise<DscCertRow | undefined> {
    const existing = currentNiaDsc(this.ctx.db)
    if (existing) return existing
    const csca = await this.ensureCscaKey()
    if (!csca) return undefined
    const cscaPair = await this.loadKeyPair(csca)
    return this.issueDsc({
      csca,
      cscaPair,
      commonName: this.ctx.config.csca.niaDsc.commonName,
      documentTypes: this.ctx.config.csca.niaDsc.documentTypes,
      validityYears: this.ctx.config.csca.niaDsc.validityYears,
      privateKeyUsageYears: this.ctx.config.csca.niaDsc.privateKeyUsageYears,
      keyBits: this.ctx.config.csca.niaDsc.keyBits,
      pss: this.ctx.config.csca.niaDsc.pss,
      source: 'nia',
      asn: null,
      keyMode: 'nia_generated',
    })
  }

  /** Issues a DSC signed by the given CSCA key. */
  async issueDsc(params: {
    csca: CscaKeyRow
    cscaPair: RsaKeyPair
    commonName: string
    documentTypes: string[]
    validityYears: number
    privateKeyUsageYears: number
    keyBits: number
    pss: boolean
    source: 'nia' | 'owned'
    asn: number | null
    keyMode: 'nia_generated' | 'user_uploaded'
    subjectPublicKey?: SubjectPublicKey
    issuancePolicy?: string | null
    applicationUrl?: string | null
  }): Promise<DscCertRow> {
    const { config, db, keks } = this.ctx
    const now = new Date()
    const issuerCert = parseCertificatePem(params.csca.certPem)

    let subject: SubjectPublicKey
    let sealedKey: string | null = null
    if (params.keyMode === 'nia_generated') {
      const key = await generateRsaKeyPair({
        modulusLength: params.keyBits,
        pss: params.pss,
        hash: 'SHA-256',
      })
      subject = key
      sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
    } else {
      if (!params.subjectPublicKey) throw new Error('subject public key is required')
      subject = params.subjectPublicKey
    }

    const generated = await createDsc(
      {
        commonName: params.commonName,
        country: config.countryAlpha2,
        documentTypes: params.documentTypes,
        notBefore: now,
        notAfter: addYears(now, params.validityYears),
        privateKeyNotAfter: addYears(now, params.privateKeyUsageYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        issuancePolicy: params.issuancePolicy ?? undefined,
        pss: params.pss,
      },
      subject,
      { certificate: issuerCert, key: params.cscaPair },
    )

    const result = db
      .insert(dscCert)
      .values({
        cscaKeyId: params.csca.id,
        serial: generated.serialHex,
        subjectDn: generated.certificate.subject,
        asn: params.asn,
        mnt: null,
        source: params.source,
        certPem: generated.pem,
        keyRef: sealedKey,
        privateKeyPemEnc: null,
        keyMode: params.keyMode,
        issuancePolicy: params.issuancePolicy ?? null,
        applicationUrl: params.applicationUrl ?? null,
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

  /** Opens the sealed private key of an NIA/owned system-generated DSC. */
  async loadDscKeyPair(row: DscCertRow, pss = false): Promise<RsaKeyPair> {
    if (!row.keyRef) throw new Error('DSC has no stored private key')
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    return importRsaKeyPair(pkcs8, pss)
  }

  /** Exports the sealed DSC private key as an unencrypted PKCS#8 PEM. */
  exportDscPrivateKey(row: DscCertRow): string {
    if (!row.keyRef) throw new AppError('certificate_not_found', 'no stored private key', 404)
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    return derToPem(pkcs8, 'PRIVATE KEY')
  }

  /** Approves an application and issues the DSC. */
  async approve(
    application: DscApplicationRow,
    adminAccountId: number | null,
  ): Promise<DscCertRow> {
    const csca = await this.ensureCscaKey()
    if (!csca) throw new Error('no CSCA key available')
    const cscaPair = await this.loadKeyPair(csca)
    const keyMode = application.keyMode === 'user_uploaded' ? 'user_uploaded' : 'nia_generated'
    const subjectPublicKey =
      keyMode === 'user_uploaded' ? await publicKeyFromApplication(application) : undefined

    const cert = await this.issueDsc({
      csca,
      cscaPair,
      commonName: application.subjectCn ?? `DSC for AS${application.asn ?? 'unknown'}`,
      documentTypes: [application.documentType ?? 'P'],
      validityYears: Math.max(1, Math.round((application.validityDays ?? 3650) / 365)),
      privateKeyUsageYears: 1,
      keyBits: this.ctx.config.csca.niaDsc.keyBits,
      pss: this.ctx.config.csca.niaDsc.pss,
      source: 'owned',
      asn: application.asn,
      keyMode,
      subjectPublicKey,
      issuancePolicy: application.issuancePolicy,
      applicationUrl: application.applicationUrl,
    })

    this.ctx.db
      .update(dscApplication)
      .set({ status: 'approved', reviewedBy: adminAccountId, reviewedAt: nowIso() })
      .where(eq(dscApplication.id, application.id))
      .run()
    return cert
  }

  /** Rejects an application. */
  reject(application: DscApplicationRow, adminAccountId: number | null, reason: string): void {
    this.ctx.db
      .update(dscApplication)
      .set({
        status: 'rejected',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        rejectReason: reason,
      })
      .where(eq(dscApplication.id, application.id))
      .run()
  }

  /** Revokes a DSC. */
  revoke(certId: number, reason: string | null): DscCertRow | undefined {
    const row = this.ctx.db.select().from(dscCert).where(eq(dscCert.id, certId)).get()
    if (!row) return undefined
    this.ctx.db
      .update(dscCert)
      .set({ status: 'revoked', revokedAt: nowIso(), revokeReason: reason })
      .where(eq(dscCert.id, certId))
      .run()
    return { ...row, status: 'revoked', revokedAt: nowIso(), revokeReason: reason }
  }

  /* ---------------------------------------------------------------- *
   * CRL (M6)
   * ---------------------------------------------------------------- */

  /** The most recently generated CRL, or undefined. */
  latestCrl(): CrlRow | undefined {
    return this.ctx.db.select().from(crl).orderBy(desc(crl.crlNumber)).get()
  }

  /**
   * Whether a CRL should be issued now (M6/T6.3):
   * none exists, a revocation post-dates the last CRL, the last CRL is older
   * than the maximum age, or the minimum refresh interval has elapsed.
   */
  crlSchedule(now: Date = new Date()): { issue: boolean; reason: string } {
    const last = this.latestCrl()
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
  async generateCrl(now: Date = new Date()): Promise<CrlRow> {
    const { db } = this.ctx
    const csca = await this.ensureCscaKey()
    if (!csca) throw new Error('no CSCA key available')
    const keyPair = await this.loadKeyPair(csca)
    const issuerCertificate = parseCertificatePem(csca.certPem)
    const revoked = db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.cscaKeyId, csca.id), eq(dscCert.status, 'revoked')))
      .all()
    const last = this.latestCrl()
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
      pss: keyPair.pss,
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
  async maybeGenerateCrl(now: Date = new Date()): Promise<CrlRow | undefined> {
    if (!this.ctx.config.crl.autoGenerate) return undefined
    return this.crlSchedule(now).issue ? this.generateCrl(now) : undefined
  }

  /* ---------------------------------------------------------------- *
   * Master List (M10)
   * ---------------------------------------------------------------- */

  /** The active Master List Signer certificate, or undefined. */
  currentMasterListSigner(): DscCertRow | undefined {
    return this.ctx.db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.source, 'ml-signer'), eq(dscCert.status, 'active')))
      .get()
  }

  /** Ensures a Master List Signer exists (EKU id-icao-cscaMasterListSigningKey). */
  async ensureMasterListSigner(): Promise<DscCertRow> {
    const existing = this.currentMasterListSigner()
    if (existing) return existing
    const { config, db, keks } = this.ctx
    const csca = await this.ensureCscaKey()
    if (!csca) throw new Error('no CSCA key available')
    const cscaPair = await this.loadKeyPair(csca)
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
        asn: null,
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
  latestMasterList(): typeof masterList.$inferSelect | undefined {
    return this.ctx.db.select().from(masterList).orderBy(desc(masterList.id)).get()
  }

  /** Builds and stores a new CSCA Master List (Doc 9303-12 §9). */
  async generateMasterList(): Promise<typeof masterList.$inferSelect> {
    const { db } = this.ctx
    const signer = await this.ensureMasterListSigner()
    const signerPair = await this.loadDscKeyPair(signer)
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
      .get() as typeof masterList.$inferSelect
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
    const linkRow = this.storeCscaKey(link, newPair, false)
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
    const next = this.storeCscaKey(generated, newPair, true)
    return { previous, next }
  }
}

/** Imports the RSA public key from an application's CSR or SPKI PEM. */
export async function publicKeyFromApplication(
  application: DscApplicationRow,
): Promise<SubjectPublicKey> {
  if (application.csrPem) {
    const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(pemBodyToDer(application.csrPem)))
    const spki = csr.subjectPublicKeyInfo.toSchema().toBER(false)
    return { publicKey: await importRsaPublicKey(new Uint8Array(spki)) }
  }
  if (application.publicKeyPem) {
    return { publicKey: await importRsaPublicKey(pemBodyToDer(application.publicKeyPem)) }
  }
  throw new Error('application has no CSR or public key')
}

async function importRsaPublicKey(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    toArrayBuffer(spki),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  )
}

/** Decodes a PEM body (or a raw DER buffer) to DER bytes. */
function pemBodyToDer(pem: string): Uint8Array {
  if (!pem.includes('-----BEGIN')) return new Uint8Array(Buffer.from(pem, 'base64'))
  const body = pem.replace(/-----[A-Z0-9 ]+-----/g, '').replace(/\s/g, '')
  return new Uint8Array(Buffer.from(body, 'base64'))
}
