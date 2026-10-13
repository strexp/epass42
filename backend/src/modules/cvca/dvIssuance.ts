/**
 * DV issuance (M17): Document Verifier certificate issuance and approval.
 *
 * A DV certificate is card-verifiable and signed by the CVCA (Doc 9303-12
 * §7.2.2).  There is no revocation mechanism for CV certificates, so a DV is
 * simply active until it expires.
 */
import { and, eq } from 'drizzle-orm'
import {
  dvPermissionsSchema,
  hasAnyPermission,
  type DvClass,
  type DvPermissions,
} from '@epass42/shared'
import {
  certificateReference,
  createCvCertificate,
  cvPublicKeyFromCsr,
  cvPublicKeyFromSpki,
  cvPublicKeyOf,
  derToPem,
  generateEcKeyPair,
  importEcKeyPair,
  parseCvCertificate,
  pemToDer,
  type CvKeyPair,
  type CvPublicKey,
} from '@epass42/pki'

import { dvApplication, dvCert, terminalApplication, terminalCert } from '../../db/schema'
import { openPrivateKey, sealPrivateKey } from '../../crypto/keyring'
import { nowIso } from '../../util/time'
import {
  addDays,
  sequenceNumber,
  type CvcaContext,
  type CvcaKeyRow,
  type DvApplicationRow,
  type DvCertRow,
  type TerminalApplicationRow,
  type TerminalCertRow,
} from './context'
import type { CvcaKeyService } from './keys'

/** Parses stored permissions JSON (falling back to the all-false default). */
export function parsePermissions(json: string | null): DvPermissions {
  if (!json) return dvPermissionsSchema.parse({})
  return dvPermissionsSchema.parse(JSON.parse(json))
}

/** Derives a valid holder mnemonic (`A-Z0-9`, up to 9) from the application. */
export function holderMnemonicOf(application: {
  holderMnemonic: string | null
  subjectCn: string | null
  mnt: string | null
}): string {
  const source = application.holderMnemonic || application.subjectCn || application.mnt || 'DV'
  const slug = source
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 9)
  return slug || 'DV'
}

/** Extracts the CV public key from an application's CSR or SPKI PEM. */
export function publicKeyFromApplication(application: {
  csrPem: string | null
  publicKeyPem: string | null
}): CvPublicKey {
  if (application.csrPem) return cvPublicKeyFromCsr(pemToDer(application.csrPem))
  if (application.publicKeyPem) return cvPublicKeyFromSpki(pemToDer(application.publicKeyPem))
  throw new Error('application has no CSR or public key')
}

/** The active CVCA default (system) DV certificate, or undefined. */
export function currentDefaultDv(db: CvcaContext['db']): DvCertRow | undefined {
  return db
    .select()
    .from(dvCert)
    .where(and(eq(dvCert.source, 'system'), eq(dvCert.status, 'active')))
    .get()
}

/** Document Verifier issuance and lifecycle. */
export class DvIssuanceService {
  constructor(
    private readonly ctx: CvcaContext,
    private readonly keys: CvcaKeyService,
  ) {}

  /** Ensures the CVCA-issued default (system) DV exists. */
  async ensureDefaultDv(): Promise<DvCertRow | undefined> {
    const existing = currentDefaultDv(this.ctx.db)
    if (existing) return existing
    const cvca = await this.keys.ensure()
    if (!cvca) return undefined
    const cvcaPair = await this.keys.loadKeyPair(cvca)
    const { config } = this.ctx
    return this.issueDv({
      cvca,
      cvcaPair,
      subjectCn: config.cvca.dv.defaultDv.commonName ?? `${config.cvca.commonName} Default DV`,
      holderMnemonic: config.cvca.dv.defaultDv.holderMnemonic,
      dvClass: 'domestic',
      permissions: config.cvca.authorization,
      validityDays: config.cvca.dv.validityDays,
      mnt: null,
      keyMode: 'remote_generated',
      source: 'system',
    })
  }

  /** Allocates an unused Certificate Holder Reference for a DV. */
  private allocateReference(holderMnemonic: string): string {
    const { config, db } = this.ctx
    const country = config.countryAlpha2
    const used = new Set(
      db
        .select()
        .from(dvCert)
        .all()
        .map((row) => row.holderReference),
    )
    let index = 1
    while (
      used.has(certificateReference(country, holderMnemonic, sequenceNumber(country, index)))
    ) {
      index += 1
    }
    return certificateReference(country, holderMnemonic, sequenceNumber(country, index))
  }

  /** Issues a DV certificate signed by the given CVCA key. */
  async issueDv(params: {
    cvca: CvcaKeyRow
    cvcaPair: CvKeyPair
    subjectCn: string | null
    holderMnemonic: string
    dvClass: DvClass
    permissions: DvPermissions
    validityDays: number
    mnt: string | null
    keyMode: 'remote_generated' | 'user_uploaded'
    /** `owned` (application-issued) or `system` (CVCA default DV). */
    source?: 'owned' | 'system'
    publicKey?: CvPublicKey
    applicationUrl?: string | null
  }): Promise<DvCertRow> {
    const { config, db, keks } = this.ctx
    const now = new Date()

    let publicKey: CvPublicKey
    let sealedKey: string | null = null
    if (params.keyMode === 'remote_generated') {
      const key = await generateEcKeyPair()
      publicKey = cvPublicKeyOf(key)
      sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
    } else {
      if (!params.publicKey) throw new Error('subject public key is required')
      publicKey = params.publicKey
    }

    const holderReference = this.allocateReference(params.holderMnemonic)
    const generated = await createCvCertificate(
      {
        country: config.countryAlpha2,
        holderMnemonic: params.holderMnemonic,
        sequence: holderReference.slice(11, 16),
        role: 'dv',
        dvClass: params.dvClass,
        permissions: params.permissions,
        notBefore: now,
        notAfter: addDays(now, params.validityDays),
        publicKey,
      },
      { authorityReference: params.cvca.holderReference, key: params.cvcaPair },
    )

    const result = db
      .insert(dvCert)
      .values({
        cvcaKeyId: params.cvca.id,
        holderReference: generated.holderReference,
        authorityReference: generated.authorityReference,
        subjectCn: params.subjectCn,
        mnt: params.mnt,
        source: params.source ?? 'owned',
        certDer: Buffer.from(generated.der),
        keyRef: sealedKey,
        keyMode: params.keyMode,
        dvClass: params.dvClass,
        permissionsJson: JSON.stringify(params.permissions),
        applicationUrl: params.applicationUrl ?? null,
        status: 'active',
        notBefore: generated.effectiveDate.toISOString(),
        notAfter: generated.expirationDate.toISOString(),
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(dvCert)
      .where(eq(dvCert.id, Number(result.lastInsertRowid)))
      .get() as DvCertRow
  }

  /** Exports the sealed private key as an unencrypted PKCS#8 PEM. */
  exportDvPrivateKey(row: { keyRef: string | null }): string {
    if (!row.keyRef) throw new Error('certificate has no stored private key')
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    return derToPem(pkcs8, 'PRIVATE KEY')
  }

  /** Opens the DV private key (for terminal certificate issuance). */
  async loadDvKeyPair(row: DvCertRow): Promise<CvKeyPair> {
    if (!row.keyRef) throw new Error('DV has no stored private key')
    const pkcs8 = openPrivateKey(row.keyRef, this.ctx.keks)
    const parsed = parseCvCertificate(new Uint8Array(row.certDer))
    if (parsed.publicKey.algorithm !== 'ec') throw new Error('DV certificate is not EC')
    return importEcKeyPair(pkcs8, parsed.publicKey.point)
  }

  /**
   * Approves an application and issues the DV.  When `override` is supplied the
   * administrator's permissions/class replace the applicant's request.
   */
  async approve(
    application: DvApplicationRow,
    adminAccountId: number | null,
    override: { permissions?: DvPermissions; dvClass?: DvClass } = {},
  ): Promise<DvCertRow> {
    const cvca = await this.keys.ensure()
    if (!cvca) throw new Error('no CVCA key available')
    const cvcaPair = await this.keys.loadKeyPair(cvca)

    const requested = parsePermissions(application.permissionsJson)
    const permissions = override.permissions ?? requested
    const dvClass = override.dvClass ?? (application.dvClass as DvClass) ?? 'domestic'
    const keyMode = application.keyMode === 'user_uploaded' ? 'user_uploaded' : 'remote_generated'
    const publicKey =
      keyMode === 'user_uploaded' ? publicKeyFromApplication(application) : undefined

    const cert = await this.issueDv({
      cvca,
      cvcaPair,
      subjectCn: application.subjectCn,
      holderMnemonic: holderMnemonicOf(application),
      dvClass,
      permissions,
      validityDays: application.validityDays ?? this.ctx.config.cvca.dv.validityDays,
      mnt: application.mnt,
      keyMode,
      publicKey,
      applicationUrl: application.applicationUrl,
    })

    this.ctx.db
      .update(dvApplication)
      .set({
        status: 'approved',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        overridePermissionsJson: override.permissions ? JSON.stringify(override.permissions) : null,
        overrideDvClass: override.dvClass ?? null,
      })
      .where(eq(dvApplication.id, application.id))
      .run()
    return cert
  }

  /** Rejects an application. */
  reject(application: DvApplicationRow, adminAccountId: number | null, reason: string): void {
    this.ctx.db
      .update(dvApplication)
      .set({
        status: 'rejected',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        rejectReason: reason,
      })
      .where(eq(dvApplication.id, application.id))
      .run()
  }

  /* Terminal (IS) certificates ----------------------------------------- */

  /** Allocates an unused Certificate Holder Reference for a terminal. */
  private allocateTerminalReference(holderMnemonic: string): string {
    const { config, db } = this.ctx
    const country = config.countryAlpha2
    const used = new Set(
      db
        .select()
        .from(terminalCert)
        .all()
        .map((row) => row.holderReference),
    )
    let index = 1
    while (
      used.has(certificateReference(country, holderMnemonic, sequenceNumber(country, index)))
    ) {
      index += 1
    }
    return certificateReference(country, holderMnemonic, sequenceNumber(country, index))
  }

  /**
   * Issues a terminal (Inspection System) certificate signed by the DV's key.
   * The terminal authorization is clamped to the DV's own grant (a DV MUST NOT
   * issue beyond what it holds, Doc 9303-12 §3.2.2).
   */
  async issueTerminal(
    dv: DvCertRow,
    params: {
      subjectCn: string | null
      holderMnemonic: string
      permissions?: DvPermissions
      validityDays: number
      mnt: string | null
      keyMode: 'remote_generated' | 'user_uploaded'
      publicKey?: CvPublicKey
    },
  ): Promise<TerminalCertRow> {
    const { config, db, keks } = this.ctx
    const now = new Date()
    const dvPair = await this.loadDvKeyPair(dv)
    const grant = parsePermissions(dv.permissionsJson)
    // An absent request authorization inherits the DV's grant; an explicit one
    // is clamped to it (a DV MUST NOT issue beyond its own authorization).
    const permissions =
      params.permissions && hasAnyPermission(params.permissions)
        ? clampPermissions(params.permissions, grant)
        : grant

    let publicKey: CvPublicKey
    let sealedKey: string | null = null
    if (params.keyMode === 'remote_generated') {
      const key = await generateEcKeyPair()
      publicKey = cvPublicKeyOf(key)
      sealedKey = sealPrivateKey(key.pkcs8, keks[0]!)
    } else {
      if (!params.publicKey) throw new Error('subject public key is required')
      publicKey = params.publicKey
    }

    const holderReference = this.allocateTerminalReference(params.holderMnemonic)
    const generated = await createCvCertificate(
      {
        country: config.countryAlpha2,
        holderMnemonic: params.holderMnemonic,
        sequence: holderReference.slice(11, 16),
        role: 'terminal',
        permissions,
        notBefore: now,
        notAfter: addDays(now, params.validityDays),
        publicKey,
      },
      { authorityReference: dv.holderReference, key: dvPair },
    )

    const result = db
      .insert(terminalCert)
      .values({
        dvCertId: dv.id,
        holderReference: generated.holderReference,
        authorityReference: generated.authorityReference,
        subjectCn: params.subjectCn,
        mnt: params.mnt,
        source: 'owned',
        certDer: Buffer.from(generated.der),
        keyRef: sealedKey,
        keyMode: params.keyMode,
        permissionsJson: JSON.stringify(permissions),
        status: 'active',
        notBefore: generated.effectiveDate.toISOString(),
        notAfter: generated.expirationDate.toISOString(),
        createdAt: nowIso(),
      })
      .run()
    return db
      .select()
      .from(terminalCert)
      .where(eq(terminalCert.id, Number(result.lastInsertRowid)))
      .get() as TerminalCertRow
  }

  /**
   * Approves a terminal application: issues the terminal certificate under the
   * resolved DV and records the review on the application.  When `override` is
   * supplied the administrator's permissions replace the applicant's request
   * (and are still clamped to the DV's grant by {@link issueTerminal}).
   */
  async approveTerminal(
    application: TerminalApplicationRow,
    dv: DvCertRow,
    adminAccountId: number | null,
    override: { permissions?: DvPermissions } = {},
  ): Promise<TerminalCertRow> {
    const requested = parsePermissions(application.permissionsJson)
    const permissions = override.permissions ?? requested
    const keyMode = application.keyMode === 'user_uploaded' ? 'user_uploaded' : 'remote_generated'
    const publicKey =
      keyMode === 'user_uploaded' ? publicKeyFromApplication(application) : undefined

    const cert = await this.issueTerminal(dv, {
      subjectCn: application.subjectCn,
      holderMnemonic: holderMnemonicOf(application),
      permissions,
      validityDays: application.validityDays ?? this.ctx.config.cvca.dv.validityDays,
      mnt: application.mnt,
      keyMode,
      publicKey,
    })

    this.ctx.db
      .update(terminalApplication)
      .set({
        status: 'approved',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        overridePermissionsJson: override.permissions ? JSON.stringify(override.permissions) : null,
        terminalCertId: cert.id,
      })
      .where(eq(terminalApplication.id, application.id))
      .run()
    return cert
  }

  /** Rejects a terminal application. */
  rejectTerminal(
    application: TerminalApplicationRow,
    adminAccountId: number | null,
    reason: string,
  ): void {
    this.ctx.db
      .update(terminalApplication)
      .set({
        status: 'rejected',
        reviewedBy: adminAccountId,
        reviewedAt: nowIso(),
        rejectReason: reason,
      })
      .where(eq(terminalApplication.id, application.id))
      .run()
  }
}

/** Clamps an authorization to a grant (bit-wise AND per field). */
export function clampPermissions(requested: DvPermissions, grant: DvPermissions): DvPermissions {
  const and = (a: { read: boolean; write: boolean }, b: { read: boolean; write: boolean }) => ({
    read: a.read && b.read,
    write: a.write && b.write,
  })
  return {
    epassport: {
      dg3: requested.epassport.dg3 && grant.epassport.dg3,
      dg4: requested.epassport.dg4 && grant.epassport.dg4,
    },
    travel: and(requested.travel, grant.travel),
    visa: and(requested.visa, grant.visa),
    biometrics: and(requested.biometrics, grant.biometrics),
  }
}
