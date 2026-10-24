/**
 * Uniform lifecycle status for a certificate (P1).
 *
 * The realm status endpoints (CSCA/DSC/DV/ML, plus the CVCA inventory) all
 * return the same shape so the front end can render both the certificate and
 * key expiry consistently.
 */
import {
  effectiveValidity,
  type CertificateFormat,
  type EffectiveValidity,
} from '../util/certificate'

/** The fields every certificate registry row provides for a status. */
export interface LifecycleSourceRow {
  id: number
  serial?: string | null
  holderReference?: string | null
  status?: string | null
  notBefore?: string | null
  notAfter: string | null
}

/** A certificate status as returned by the lifecycle endpoints. */
export interface LifecycleCertificate {
  id: number
  serial?: string
  holderReference?: string
  status?: string
  notBefore: string | null
  notAfter: string | null
  /** Whether the certificate itself has expired. */
  certificateExpired: boolean
  /** The PrivateKeyUsagePeriod notAfter, when the certificate carries one. */
  privateKeyNotAfter: string | null
  /** Whether the private key usage period has ended. */
  privateKeyExpired: boolean
  /** The issuer certificate's notAfter, when known. */
  parentNotAfter: string | null
  /** Whether the issuer certificate has expired. */
  parentExpired: boolean
  /** The earliest of the certificate, private key and parent expiries. */
  effectiveNotAfter: string | null
  /** True when the certificate is unusable for any of the reasons above. */
  expired: boolean
  daysRemaining: number | null
}

/** Options for {@link lifecycleCertificate}. */
export interface LifecycleCertificateOptions {
  format: CertificateFormat
  /** The X.509 PEM; required to read the PrivateKeyUsagePeriod. */
  certPem?: string | null
  /** The issuer certificate's notAfter. */
  parentNotAfter?: string | null
}

/** Builds the uniform status object for a certificate row. */
export function lifecycleCertificate(
  row: LifecycleSourceRow,
  options: LifecycleCertificateOptions,
  now: Date = new Date(),
): LifecycleCertificate {
  const validity: EffectiveValidity = effectiveValidity(
    {
      format: options.format,
      notAfter: row.notAfter,
      certPem: options.certPem,
      parentNotAfter: options.parentNotAfter,
    },
    now,
  )
  return {
    id: row.id,
    ...(row.serial != null ? { serial: row.serial } : {}),
    ...(row.holderReference != null ? { holderReference: row.holderReference } : {}),
    ...(row.status != null ? { status: row.status } : {}),
    notBefore: row.notBefore ?? null,
    notAfter: row.notAfter,
    certificateExpired: validity.certificateExpired,
    privateKeyNotAfter: validity.privateKeyNotAfter,
    privateKeyExpired: validity.privateKeyExpired,
    parentNotAfter: validity.parentNotAfter,
    parentExpired: validity.parentExpired,
    effectiveNotAfter: validity.effectiveNotAfter,
    expired: validity.expired,
    daysRemaining: validity.daysRemaining,
  }
}
