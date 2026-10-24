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
