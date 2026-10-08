/**
 * Global constants for the pkd42 project.
 *
 * The country codes below are used throughout the DN/PKD paths and the MRZ.
 */

/** ISO 3166-1 alpha-2 style code used in DN/PKD paths (`c=XD`). */
export const COUNTRY_ALPHA2 = 'XD' as const

/** ICAO Doc 9303 three-letter code used in the MRZ and `localityName`. */
export const COUNTRY_ALPHA3 = 'UDN' as const

/** The available service roles; a deployment may enable a subset. */
export const ROLES = ['pkd', 'csca', 'dsc'] as const
export type Role = (typeof ROLES)[number]

/** The two independent OAuth realms (CSCA and DSC logins differ). */
export const REALMS = ['csca', 'dsc'] as const
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
