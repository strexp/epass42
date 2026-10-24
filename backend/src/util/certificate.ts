import { OIDS } from '@epass42/shared'
import { parseCertificatePem, parseTlv } from '@epass42/pki'

/**
 * Certificate validity helpers shared by the lifecycle gates and status
 * endpoints.  The stored `not_after` value is authoritative; a missing value is
 * treated as expired so a malformed row fails closed.
 */

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
  const certificate = certificateValidity(notAfter, now)
  let privateKeyEnd: Date | null = null
  let privateKeyExpired = false
  try {
    privateKeyEnd = privateKeyNotAfter(certPem)
  } catch {
    privateKeyExpired = true
  }
  if (privateKeyEnd) privateKeyExpired = privateKeyEnd.getTime() <= now.getTime()
  return {
    ...certificate,
    expired: certificate.expired || privateKeyExpired,
    certificateExpired: certificate.expired,
    privateKeyNotAfter: privateKeyEnd?.toISOString() ?? null,
    privateKeyExpired,
  }
}
