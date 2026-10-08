/**
 * Global constants for the pkd42 simulation.
 *
 * The project is a dn42 role-play system and MUST NOT be used for real identity
 * documents.  The country codes below are reserved for this simulation.
 */

/** ISO 3166-1 alpha-2 style code used in DN/PKD paths (`c=XD`). */
export const COUNTRY_ALPHA2 = 'XD' as const

/** ICAO Doc 9303 three-letter code used in the MRZ and `localityName`. */
export const COUNTRY_ALPHA3 = 'UDN' as const

/** The available service roles; a deployment may enable a subset. */
export const ROLES = ['pkd', 'csca', 'dsc'] as const
export type Role = (typeof ROLES)[number]

/** The two independent OAuth realms (`PLAN.md`: CSCA and DSC logins differ). */
export const REALMS = ['csca', 'dsc'] as const
export type Realm = (typeof REALMS)[number]

/** Human-readable disclaimer shown in the UI and embedded in every artifact. */
export const DISCLAIMER =
  'pkd42 is a dn42 simulation of ICAO PKD/CSCA/DSC. ' +
  'Not valid for real identity documents or any official use.'

/** Cryptographic defaults. */
export const CRYPTO = {
  /** Default CSCA RSA modulus size. */
  cscaRsaBits: 4096,
  /** Default DSC RSA modulus size. */
  dscRsaBits: 2048,
  /** Default hash algorithm. */
  hash: 'SHA-256',
  /** Default eMRTD digest (LDS Security Object) algorithm. */
  ldsDigest: 'SHA-256',
} as const

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
