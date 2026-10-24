/**
 * Global constants for the ePass 42 project.
 *
 * The country codes below are used throughout the DN/PKD paths and the MRZ.
 */

/** ISO 3166-1 alpha-2 style code used in DN/PKD paths (`c=XD`). */
export const COUNTRY_ALPHA2 = 'XD' as const

/** ICAO Doc 9303 three-letter code used in the MRZ and `localityName`. */
export const COUNTRY_ALPHA3 = 'XDN' as const

/** The available service roles; a deployment may enable a subset. */
export const ROLES = ['pkd', 'csca', 'cvca', 'dv', 'dsc', 'ml'] as const
export type Role = (typeof ROLES)[number]

/**
 * The independent OAuth realms (CSCA, CVCA, DV, DSC and ML logins are separate).
 * CVCA is the country-level authorization PKI trust anchor (Doc 9303-12 §3.2);
 * DV holders log in to the DV realm to apply for terminal certificates.
 */
export const REALMS = ['csca', 'cvca', 'dv', 'dsc', 'ml'] as const
export type Realm = (typeof REALMS)[number]

/** Maximum sizes for DSC signing requests (bytes). */
export const LIMITS = {
  /** DG2 (face) content. */
  dg2: 64 * 1024,
  /** DG3 / DG4 biometric template. */
  biometric: 64 * 1024,
  /** DG5 / DG7 display image. */
  displayImage: 128 * 1024,
  /** Whole DSC request payload. */
  requestPayload: 2 * 1024 * 1024,
} as const

/** Maximum length of a subject CN/O/OU attribute accepted by the service. */
export const SUBJECT_NAME_MAX = 64

/**
 * Characters allowed in applicant-supplied subject attributes.  Commas, plus
 * signs, quotes, backslashes, semicolons, angle brackets and equals signs are
 * excluded so a value cannot inject additional RDNs into the DN.
 */
export const SUBJECT_NAME_PATTERN = /^[\p{L}\p{N} ._'()&@-]+$/u

/** True when a subject attribute is non-empty and uses only safe characters. */
export function isValidSubjectName(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length > 0 && SUBJECT_NAME_PATTERN.test(trimmed)
}
