/**
 * DSC issuance (M5): NIA Document Signer bootstrap, issuance, approval,
 * revocation and one-time private-key export.
 */
import * as pkijs from 'pkijs'
import { and, eq } from 'drizzle-orm'

import { AppError } from '@pkd42/shared'
import {
  createDsc,
  derToPem,
  generateRsaKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  pemToDer,
  toArrayBuffer,
  type RsaKeyPair,
  type SubjectPublicKey,
} from '@pkd42/pki'

import { dscApplication, dscCert } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import {
  addYears,
  type CscaContext,
  type DscApplicationRow,
  type DscCertRow,
  type CscaKeyRow,
} from './context'
import type { CscaKeyService } from './keys'

/** The active NIA Document Signer certificate, or undefined. */
export function currentNiaDsc(db: CscaContext['db']): DscCertRow | undefined {
  return db
    .select()
    .from(dscCert)
    .where(and(eq(dscCert.source, 'nia'), eq(dscCert.status, 'active')))
    .get()
}

/** Document Signer issuance and lifecycle. */
export class DscIssuanceService {
  constructor(
    private readonly ctx: CscaContext,
    private readonly keys: CscaKeyService,
  ) {}

  /** Ensures an active NIA DSC exists (creating one signed by the CSCA). */
  async ensureNiaDsc(): Promise<DscCertRow | undefined> {
    const existing = currentNiaDsc(this.ctx.db)
    if (existing) return existing
    const csca = await this.keys.ensure()
    if (!csca) return undefined
    const cscaPair = await this.keys.loadKeyPair(csca)
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
      mnt: null,
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
    mnt: string | null
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
        mnt: params.mnt,
        source: params.source,
        certPem: generated.pem,
        keyRef: sealedKey,
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
    const csca = await this.keys.ensure()
    if (!csca) throw new Error('no CSCA key available')
    const cscaPair = await this.keys.loadKeyPair(csca)
    const keyMode = application.keyMode === 'user_uploaded' ? 'user_uploaded' : 'nia_generated'
    const subjectPublicKey =
      keyMode === 'user_uploaded' ? await publicKeyFromApplication(application) : undefined

    const cert = await this.issueDsc({
      csca,
      cscaPair,
      commonName: application.subjectCn ?? `DSC for ${application.mnt ?? 'unknown'}`,
      documentTypes: [application.documentType ?? 'P'],
      validityYears: Math.max(1, Math.round((application.validityDays ?? 3650) / 365)),
      privateKeyUsageYears: 1,
      keyBits: this.ctx.config.csca.niaDsc.keyBits,
      pss: this.ctx.config.csca.niaDsc.pss,
      source: 'owned',
      mnt: application.mnt,
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
}

/** Imports the RSA public key from an application's CSR or SPKI PEM. */
export async function publicKeyFromApplication(
  application: DscApplicationRow,
): Promise<SubjectPublicKey> {
  if (application.csrPem) {
    const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(pemToDer(application.csrPem)))
    const spki = csr.subjectPublicKeyInfo.toSchema().toBER(false)
    return { publicKey: await importRsaPublicKey(new Uint8Array(spki)) }
  }
  if (application.publicKeyPem) {
    return { publicKey: await importRsaPublicKey(pemToDer(application.publicKeyPem)) }
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
