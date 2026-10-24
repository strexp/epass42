import { OIDS } from '@epass42/shared'
import { parseCertificatePem, parseTlv } from '@epass42/pki'

/**
 * Certificate validity helpers shared by the lifecycle gates and status
 * endpoints.  The stored `not_after` value is authoritative; a missing value is
 * treated as expired so a malformed row fails closed.
 */

/** The encoding of a certificate: X.509 PEM or an ISO 18013 CV certificate. */
export type CertificateFormat = 'x509' | 'cv'

/** The validity state of a stored certificate. */
export interface CertificateValidity {
  notAfter: string | null
  expired: boolean
  /** Whole days until expiry; negative when already expired. */
  daysRemaining: number | null
}

/** Computes the validity state of a certificate at `now`. */
export function certificateValidity(
  notAfter: string | null | undefined,
  now: Date = new Date(),
): CertificateValidity {
  if (!notAfter) return { notAfter: null, expired: true, daysRemaining: null }
  const expires = Date.parse(notAfter)
  if (Number.isNaN(expires)) return { notAfter, expired: true, daysRemaining: null }
  const remaining = expires - now.getTime()
  return {
    notAfter,
    expired: remaining <= 0,
    daysRemaining: Math.floor(remaining / 86_400_000),
  }
}

/** True when a certificate is missing or past its `notAfter`. */
export function isCertificateExpired(
  notAfter: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return certificateValidity(notAfter, now).expired
}

/** The validity state of a signer certificate, including its private key period. */
export interface SignerValidity extends CertificateValidity {
  /** Whether the certificate itself has expired. */
  certificateExpired: boolean
  /** The PrivateKeyUsagePeriod notAfter, when the certificate carries one. */
  privateKeyNotAfter: string | null
  /** Whether the private key usage period has ended. */
  privateKeyExpired: boolean
}

/** The effective validity of a certificate, including its parent chain. */
export interface EffectiveValidity extends SignerValidity {
  /** The earliest of the certificate, private key and parent expiries. */
  effectiveNotAfter: string | null
  /** The parent (issuer) certificate's notAfter, when supplied. */
  parentNotAfter: string | null
  /** Whether the parent certificate has already expired. */
  parentExpired: boolean
}

/** Parses the GeneralizedTime inside a PrivateKeyUsagePeriod extension. */
function parseGeneralizedTime(value: Uint8Array): Date {
  const text = Buffer.from(value).toString('ascii').trim()
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
  if (!match) throw new Error(`malformed GeneralizedTime: ${text}`)
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  )
}

/** Reads the `notAfter` of the PrivateKeyUsagePeriod extension, or null. */
export function privateKeyNotAfter(certPem: string): Date | null {
  const certificate = parseCertificatePem(certPem)
  const extension = certificate.getExtension(OIDS.privateKeyUsagePeriod)
  if (!extension) return null
  const node = parseTlv(new Uint8Array(extension.value))
  const notAfter = node.children.find((child) => child.tag === 0x81)
  if (!notAfter) return null
  return parseGeneralizedTime(notAfter.value)
}

/** The inputs for {@link effectiveValidity}. */
export interface EffectiveValidityInput {
  format: CertificateFormat
  notAfter: string | null | undefined
  /** The X.509 certificate PEM (required to read PrivateKeyUsagePeriod). */
  certPem?: string | null
  /** The issuer certificate's notAfter, when the certificate chains to one. */
  parentNotAfter?: string | null
}

/**
 * Computes the effective validity of a certificate:
 *
 * - X.509 certificates may carry a PrivateKeyUsagePeriod; a signer is unusable
 *   once either the certificate or its private key period ends.
 * - CV certificates carry no private-key period in this design.
 * - A certificate cannot outlive its issuer; when the parent's notAfter is
 *   supplied it is included in the earliest-expiry calculation.
 *
 * Malformed private-key periods fail closed.
 */
export function effectiveValidity(
  input: EffectiveValidityInput,
  now: Date = new Date(),
): EffectiveValidity {
  const certificate = certificateValidity(input.notAfter, now)
  let privateKeyEnd: Date | null = null
  let privateKeyExpired = false
  if (input.format === 'x509' && input.certPem) {
    try {
      privateKeyEnd = privateKeyNotAfter(input.certPem)
    } catch {
      privateKeyExpired = true
    }
    if (privateKeyEnd) privateKeyExpired = privateKeyEnd.getTime() <= now.getTime()
  }

  const parent =
    input.parentNotAfter !== undefined && input.parentNotAfter !== null
      ? certificateValidity(input.parentNotAfter, now)
      : null
  const parentExpired = parent?.expired ?? false

  const candidates = [
    certificate.notAfter,
    privateKeyEnd?.toISOString() ?? null,
    parent?.notAfter ?? null,
  ]
    .filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  const effectiveNotAfter = candidates[0] ?? certificate.notAfter
  const effectiveMs = effectiveNotAfter ? Date.parse(effectiveNotAfter) : Number.NaN
  const daysRemaining = Number.isNaN(effectiveMs)
    ? certificate.daysRemaining
    : Math.floor((effectiveMs - now.getTime()) / 86_400_000)
  const expired = certificate.expired || privateKeyExpired || parentExpired

  return {
    ...certificate,
    expired,
    daysRemaining,
    certificateExpired: certificate.expired,
    privateKeyNotAfter: privateKeyEnd?.toISOString() ?? null,
    privateKeyExpired,
    effectiveNotAfter,
    parentNotAfter: parent?.notAfter ?? null,
    parentExpired,
  }
}

/**
 * Computes the effective validity of a signer certificate.  A signer is
 * unusable when either the certificate or its private key usage period has
 * expired; malformed private-key periods fail closed.
 */
export function signerValidity(
  notAfter: string | null | undefined,
  certPem: string,
  now: Date = new Date(),
): SignerValidity {
  const validity = effectiveValidity({ format: 'x509', notAfter, certPem }, now)
  return {
    notAfter: validity.notAfter,
    expired: validity.expired,
    daysRemaining: validity.daysRemaining,
    certificateExpired: validity.certificateExpired,
    privateKeyNotAfter: validity.privateKeyNotAfter,
    privateKeyExpired: validity.privateKeyExpired,
  }
}

/**
 * Clamps a proposed notAfter to an issuer's notAfter.  A certificate never
 * outlives the certificate that signs it.
 */
export function clampNotAfter(notAfter: Date, parentNotAfter: string | null | undefined): Date {
  if (!parentNotAfter) return notAfter
  const parent = Date.parse(parentNotAfter)
  if (Number.isNaN(parent)) return notAfter
  return notAfter.getTime() > parent ? new Date(parent) : notAfter
}
