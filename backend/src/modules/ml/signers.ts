/**
 * Master List Signer lifecycle (Doc 9303-12 §9).
 *
 * The signer certificate is issued by the CSCA (that is the trust-chain
 * requirement), but its key, storage, expiry and rotation belong to the ML
 * role.  The signer is stored in `dsc_cert` with `source = 'ml-signer'` so the
 * existing sealed-key and master-list references keep working.
 */
import { and, desc, eq } from 'drizzle-orm'

import { AppError } from '@epass42/shared'
import {
  createMasterListSigner,
  ecPointFromSpki,
  generateEcKeyPair,
  generateRsaKeyPair,
  importEcKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  sha256,
  type CertKeyPair,
  type EcCurve,
  type HashName,
} from '@epass42/pki'

import { dscCert } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { clampNotAfter, effectiveValidity } from '../../util/certificate'
import { addYears, nowIso } from '../../util/time'
import type { CscaService } from '../csca/service'
import { currentCscaKey } from '../csca/service'
import type { MlContext, MlSignerRow } from './context'

/** The metadata exposed for an ML signer certificate. */
export interface MlSignerMetadata {
  id: number
  serial: string
  subjectDn: string
  status: string
  source: string
  keyAlgorithm: string | null
  notBefore: string | null
  notAfter: string | null
  createdAt: string
  fingerprintSha256: string
}

/** The stored key algorithm of a freshly generated key pair. */
function keyAlgorithmOf(key: CertKeyPair): string {
  if ('curve' in key) return `ECDSA-${key.curve.replace('-', '')}`
  return key.pss ? 'RSASSA-PSS' : 'RSASSA-PKCS1-v1_5'
}

/** The curve encoded in a stored `key_algorithm` value. */
function curveOf(keyAlgorithm: string): EcCurve {
  return keyAlgorithm.includes('P384') ? 'P-384' : 'P-256'
}

/** Certificate metadata, including the DER SHA-256 fingerprint. */
export function signerMetadata(row: MlSignerRow): MlSignerMetadata {
  const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
  return {
    id: row.id,
    serial: row.serial,
    subjectDn: row.subjectDn,
    status: row.status,
    source: row.source,
    keyAlgorithm: row.keyAlgorithm,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    createdAt: row.createdAt,
    fingerprintSha256: Buffer.from(sha256(der)).toString('hex'),
  }
}

/** Master List Signer storage and lifecycle. */
export class MlSignerService {
  constructor(
    private readonly ctx: MlContext,
    private readonly csca: CscaService,
  ) {}

  /** The active Master List Signer, or undefined. */
  current(): MlSignerRow | undefined {
    return this.ctx.db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.source, 'ml-signer'), eq(dscCert.status, 'active')))
      .orderBy(desc(dscCert.id))
      .get()
  }

  /** An ML signer row by id, or undefined. */
  byId(id: number): MlSignerRow | undefined {
    return this.ctx.db
      .select()
      .from(dscCert)
      .where(and(eq(dscCert.id, id), eq(dscCert.source, 'ml-signer')))
      .get()
  }

  /**
   * Ensures an active signer exists.  Only the configured bootstrap flag
   * creates one automatically; an explicit rotation is the manual path.
   */
  async ensure(): Promise<MlSignerRow | undefined> {
    const existing = this.current()
    if (existing) return existing
    if (!this.ctx.config.ml.bootstrap) return undefined
    return this.create()
  }

  /**
   * Manually creates or rotates the ML signer.  The previous active signer is
   * retired; on failure it is restored so master-list generation keeps working.
   */
  async rotate(): Promise<{ previous: MlSignerRow | null; current: MlSignerRow }> {
    // Fail before retiring the old signer when the CSCA cannot issue.
    this.requireUsableCsca()
    const previous = this.current() ?? null
    if (previous) {
      this.ctx.db
        .update(dscCert)
        .set({ status: 'retired' })
        .where(eq(dscCert.id, previous.id))
        .run()
    }
    try {
      const current = await this.create()
      return { previous, current }
    } catch (error) {
      if (previous) {
        this.ctx.db
          .update(dscCert)
          .set({ status: 'active' })
          .where(eq(dscCert.id, previous.id))
          .run()
      }
      throw error
    }
  }

  /** Creates and stores a signer under the current CSCA key. */
  private async create(): Promise<MlSignerRow> {
    const csca = this.requireUsableCsca()
    const { config, db, keks } = this.ctx
    const signerConfig = config.ml.signer
    const cscaPair = await this.csca.loadKeyPair(csca, config.csca.hash as HashName)
    const now = new Date()

    const key =
      signerConfig.algorithm === 'ecdsa'
        ? await generateEcKeyPair(signerConfig.curve)
        : await generateRsaKeyPair({
            modulusLength: signerConfig.keyBits,
            pss: signerConfig.pss,
            hash: signerConfig.hash as HashName,
          })

    const generated = await createMasterListSigner(
      {
        commonName: signerConfig.commonName ?? `${config.csca.commonName} ML Signer`,
        country: config.countryAlpha2,
        organization: signerConfig.organization ?? config.csca.organization,
        organizationalUnit: signerConfig.organizationalUnit ?? config.csca.organizationalUnit,
        notBefore: now,
        // A signer never outlives the CSCA certificate that signs it.
        notAfter: clampNotAfter(addYears(now, signerConfig.validityYears), csca.notAfter),
        crlDistributionPoints: config.csca.crlDistributionPoints,
        hash: signerConfig.hash as HashName,
      },
      key,
      {
        certificate: parseCertificatePem(csca.certPem),
        key: cscaPair,
        hash: config.csca.hash as HashName,
      },
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
        keyAlgorithm: keyAlgorithmOf(key),
        keyMode: 'remote_generated',
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
      .get() as MlSignerRow
  }

  /** Opens the sealed private key of a signer. */
  async loadKeyPair(row: MlSignerRow): Promise<CertKeyPair> {
    if (!row.keyRef) throw new AppError('certificate_not_found', 'ML signer has no stored key', 404)
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    const algorithm = row.keyAlgorithm ?? 'RSASSA-PKCS1-v1_5'
    if (algorithm.startsWith('ECDSA')) {
      const curve = curveOf(algorithm)
      const cert = parseCertificatePem(row.certPem)
      const point = await ecPointFromSpki(new Uint8Array(cert.publicKey.rawData), curve)
      return importEcKeyPair(pkcs8, point, curve)
    }
    return importRsaKeyPair(
      pkcs8,
      algorithm === 'RSASSA-PSS',
      this.ctx.config.ml.signer.hash as HashName,
    )
  }

  /** The current CSCA key, or a 409 when it cannot issue a signer. */
  private requireUsableCsca() {
    const csca = currentCscaKey(this.ctx.db)
    if (!csca) {
      throw new AppError('csca_missing', 'no CSCA key available to issue the ML signer', 409)
    }
    if (
      effectiveValidity({ format: 'x509', notAfter: csca.notAfter, certPem: csca.certPem }).expired
    ) {
      throw new AppError(
        'csca_expired',
        'the CSCA certificate or its private key has expired; roll the CSCA key over first',
        409,
      )
    }
    return csca
  }
}
