/**
 * DSC issuance (M5): NIA Document Signer bootstrap, issuance, approval,
 * revocation and one-time private-key export.
 */
import * as pkijs from 'pkijs'
import { and, eq } from 'drizzle-orm'

import { AppError, type Lds2SignerType } from '@epass42/shared'
import {
  createDsc,
  createLds2Signer,
  derToPem,
  ecPointFromSpki,
  generateEcKeyPair,
  generateRsaKeyPair,
  importEcKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  pemToDer,
  toArrayBuffer,
  type CertKeyPair,
  type EcCurve,
  type HashName,
  type SubjectPublicKey,
} from '@epass42/pki'

import { dscApplication, dscCert } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import {
  addDays,
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
    .where(
      and(
        eq(dscCert.source, 'nia'),
        eq(dscCert.certificateType, 'dsc'),
        eq(dscCert.status, 'active'),
      ),
    )
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
    const cscaPair = await this.keys.loadKeyPair(csca, this.ctx.config.csca.hash as HashName)
    return this.issueDsc({
      csca,
      cscaPair,
      commonName: this.ctx.config.csca.niaDsc.commonName,
      documentTypes: this.ctx.config.csca.niaDsc.documentTypes,
      validityYears: this.ctx.config.csca.niaDsc.validityYears,
      privateKeyUsageYears: this.ctx.config.csca.niaDsc.privateKeyUsageYears,
      source: 'nia',
      mnt: null,
      keyMode: 'remote_generated',
    })
  }

  /** Issues a DSC signed by the given CSCA key. */
  async issueDsc(params: {
    csca: CscaKeyRow
    cscaPair: CertKeyPair
    commonName: string
    /** Applicant-chosen subject names; fall back to the CSCA profile. */
    organization?: string | null
    organizationalUnit?: string | null
    documentTypes: string[]
    validityYears: number
    privateKeyUsageYears: number
    source: 'nia' | 'owned'
    mnt: string | null
    keyMode: 'remote_generated' | 'user_uploaded'
    subjectPublicKey?: SubjectPublicKey
    issuancePolicy?: string | null
    applicationUrl?: string | null
  }): Promise<DscCertRow> {
    const { config, db, keks } = this.ctx
    const now = new Date()
    const issuerCert = parseCertificatePem(params.csca.certPem)
    const nia = config.csca.niaDsc

    let subject: SubjectPublicKey
    let sealedKey: string | null = null
    let keyAlgorithm: string
    if (params.keyMode === 'remote_generated') {
      if (nia.algorithm === 'ecdsa') {
        const key = await generateEcKeyPair(nia.curve)
        subject = { publicKey: key.publicKey }
        sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
        keyAlgorithm = `ECDSA-${key.curve.replace('-', '')}`
      } else {
        const key = await generateRsaKeyPair({
          modulusLength: nia.keyBits,
          pss: nia.pss,
          hash: nia.hash as HashName,
        })
        subject = key
        sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
        keyAlgorithm = key.pss ? 'RSASSA-PSS' : 'RSASSA-PKCS1-v1_5'
      }
    } else {
      if (!params.subjectPublicKey) throw new Error('subject public key is required')
      subject = params.subjectPublicKey
      keyAlgorithm = 'external'
    }

    const generated = await createDsc(
      {
        commonName: params.commonName,
        country: config.countryAlpha2,
        organization: params.organization ?? config.csca.organization,
        organizationalUnit: params.organizationalUnit ?? config.csca.organizationalUnit,
        documentTypes: params.documentTypes,
        notBefore: now,
        notAfter: addYears(now, params.validityYears),
        privateKeyNotAfter: addYears(now, params.privateKeyUsageYears),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        issuancePolicy: params.issuancePolicy ?? undefined,
        hash: nia.hash as HashName,
      },
      subject,
      { certificate: issuerCert, key: params.cscaPair, hash: config.csca.hash as HashName },
    )

    const result = db
      .insert(dscCert)
      .values({
        cscaKeyId: params.csca.id,
        serial: generated.serialHex,
        subjectDn: generated.certificate.subject,
        mnt: params.mnt,
        source: params.source,
        certificateType: 'dsc',
        certPem: generated.pem,
        keyRef: sealedKey,
        keyAlgorithm,
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

  /**
   * Issues an LDS2 Signer certificate (Doc 9303-12 §7.1.2) signed by the given
   * CSCA key.  The subject key is always ECDSA: it is either generated here
   * (P-256) or imported from the application's CSR/SPKI.
   */
  async issueLds2Signer(params: {
    csca: CscaKeyRow
    cscaPair: CertKeyPair
    commonName: string
    lds2Types: Lds2SignerType[]
    validityDays: number
    source: 'owned'
    mnt: string | null
    keyMode: 'remote_generated' | 'user_uploaded'
    subjectPublicKey?: SubjectPublicKey
    subjectKeyAlgorithm?: string
    issuancePolicy?: string | null
    applicationUrl?: string | null
  }): Promise<DscCertRow> {
    const { config, db, keks } = this.ctx
    const now = new Date()
    const types = [...new Set(params.lds2Types)]
    if (types.length === 0) throw new Error('an LDS2 Signer needs at least one role')
    const commonName = params.commonName.slice(0, 9)
    if (commonName.length === 0) throw new Error('an LDS2 Signer needs a common name')

    let subjectPublicKey: SubjectPublicKey
    let sealedKey: string | null = null
    let keyAlgorithm: string
    if (params.keyMode === 'remote_generated') {
      const key = await generateEcKeyPair('P-256')
      subjectPublicKey = { publicKey: key.publicKey }
      sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
      keyAlgorithm = 'ECDSA-P256'
    } else {
      if (!params.subjectPublicKey) throw new Error('subject public key is required')
      if (params.subjectPublicKey.publicKey.algorithm.name !== 'ECDSA') {
        throw new AppError(
          'bad_request',
          'an LDS2 Signer subject key must be ECDSA (P-256 or P-384)',
          400,
        )
      }
      subjectPublicKey = params.subjectPublicKey
      keyAlgorithm = params.subjectKeyAlgorithm ?? 'ECDSA-P256'
    }

    const issuerCert = parseCertificatePem(params.csca.certPem)
    const generated = await createLds2Signer(
      {
        commonName,
        country: config.countryAlpha2,
        lds2Types: types,
        notBefore: now,
        notAfter: addDays(now, params.validityDays),
        hash: config.csca.hash as HashName,
      },
      subjectPublicKey,
      { certificate: issuerCert, key: params.cscaPair, hash: config.csca.hash as HashName },
    )

    const result = db
      .insert(dscCert)
      .values({
        cscaKeyId: params.csca.id,
        serial: generated.serialHex,
        subjectDn: generated.certificate.subject,
        mnt: params.mnt,
        source: params.source,
        certificateType: 'lds2',
        lds2Types: types,
        certPem: generated.pem,
        keyRef: sealedKey,
        keyAlgorithm,
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
  async loadDscKeyPair(row: DscCertRow, hash?: HashName): Promise<CertKeyPair> {
    if (!row.keyRef) throw new Error('DSC has no stored private key')
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    const algorithm = row.keyAlgorithm ?? 'RSASSA-PKCS1-v1_5'
    if (algorithm.startsWith('ECDSA')) {
      const curve: EcCurve = algorithm.includes('P384') ? 'P-384' : 'P-256'
      const cert = parseCertificatePem(row.certPem)
      const point = await ecPointFromSpki(new Uint8Array(cert.publicKey.rawData), curve)
      return importEcKeyPair(pkcs8, point, curve)
    }
    return importRsaKeyPair(
      pkcs8,
      algorithm === 'RSASSA-PSS',
      hash ?? (this.ctx.config.csca.niaDsc.hash as HashName),
    )
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
    const cscaPair = await this.keys.loadKeyPair(csca, this.ctx.config.csca.hash as HashName)
    const keyMode = application.keyMode === 'user_uploaded' ? 'user_uploaded' : 'remote_generated'

    let cert: DscCertRow
    if (application.certificateType === 'lds2') {
      const lds2Types = [...new Set(application.lds2Types ?? [])]
      if (lds2Types.length === 0) {
        throw new AppError('bad_request', 'an LDS2 Signer needs at least one role', 400)
      }
      const uploaded =
        keyMode === 'user_uploaded' ? await ecdsaPublicKeyFromApplication(application) : undefined
      cert = await this.issueLds2Signer({
        csca,
        cscaPair,
        commonName: application.subjectCn ?? `LDS2${application.mnt ?? ''}`.slice(0, 9),
        lds2Types,
        validityDays: application.validityDays ?? this.ctx.config.csca.lds2.validityDays,
        source: 'owned',
        mnt: application.mnt,
        keyMode,
        subjectPublicKey: uploaded?.subjectPublicKey,
        subjectKeyAlgorithm: uploaded?.keyAlgorithm,
        issuancePolicy: application.issuancePolicy,
        applicationUrl: application.applicationUrl,
      })
    } else {
      const subjectPublicKey =
        keyMode === 'user_uploaded' ? await publicKeyFromApplication(application) : undefined
      cert = await this.issueDsc({
        csca,
        cscaPair,
        commonName: application.subjectCn ?? `DSC for ${application.mnt ?? 'unknown'}`,
        organization: application.subjectO,
        organizationalUnit: application.subjectOu,
        documentTypes:
          application.documentTypes && application.documentTypes.length > 0
            ? application.documentTypes
            : ['P'],
        validityYears: Math.max(1, Math.round((application.validityDays ?? 3650) / 365)),
        privateKeyUsageYears: 1,
        source: 'owned',
        mnt: application.mnt,
        keyMode,
        subjectPublicKey,
        issuancePolicy: application.issuancePolicy,
        applicationUrl: application.applicationUrl,
      })
    }

    this.ctx.db
      .update(dscApplication)
      .set({
        status: 'approved',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        dscCertId: cert.id,
      })
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

/** Extracts the SubjectPublicKeyInfo from an application's CSR or SPKI PEM. */
function spkiFromApplication(application: DscApplicationRow): Uint8Array {
  if (application.csrPem) {
    const csr = pkijs.CertificationRequest.fromBER(toArrayBuffer(pemToDer(application.csrPem)))
    return new Uint8Array(csr.subjectPublicKeyInfo.toSchema().toBER(false))
  }
  if (application.publicKeyPem) return pemToDer(application.publicKeyPem)
  throw new Error('application has no CSR or public key')
}

/** Imports the public key (EC or RSA) from an application's CSR or SPKI PEM. */
export async function publicKeyFromApplication(
  application: DscApplicationRow,
): Promise<SubjectPublicKey> {
  return { publicKey: await importPublicKey(spkiFromApplication(application)) }
}

/** Imports an ECDSA key and records its curve (LDS2 Signers must use ECDSA). */
export async function ecdsaPublicKeyFromApplication(application: DscApplicationRow): Promise<{
  subjectPublicKey: SubjectPublicKey
  keyAlgorithm: string
}> {
  const spki = spkiFromApplication(application)
  for (const namedCurve of ['P-256', 'P-384'] as const) {
    try {
      const publicKey = await crypto.subtle.importKey(
        'spki',
        toArrayBuffer(spki),
        { name: 'ECDSA', namedCurve },
        true,
        ['verify'],
      )
      return {
        subjectPublicKey: { publicKey },
        keyAlgorithm: `ECDSA-${namedCurve.replace('-', '')}`,
      }
    } catch {
      /* try the next curve */
    }
  }
  throw new AppError(
    'bad_request',
    'an LDS2 Signer subject key must be ECDSA (P-256 or P-384)',
    400,
  )
}

async function importPublicKey(spki: Uint8Array): Promise<CryptoKey> {
  for (const namedCurve of ['P-256', 'P-384'] as const) {
    try {
      return await crypto.subtle.importKey(
        'spki',
        toArrayBuffer(spki),
        { name: 'ECDSA', namedCurve },
        true,
        ['verify'],
      )
    } catch {
      /* try the next curve / RSA */
    }
  }
  return crypto.subtle.importKey(
    'spki',
    toArrayBuffer(spki),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    true,
    ['verify'],
  )
}
