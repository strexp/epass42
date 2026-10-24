/**
 * dn42 identities used by the backend suite.
 *
 * Each identity is a plain OIDC claim set accepted by the fake driver.  The
 * realm administrators are maintainers listed in `backend/src/test-support.ts`;
 * the users are ordinary maintainers that can only act inside their own scope.
 */

/** The dn42 claim shape consumed by `mapClaims`. */
export interface TestIdentity {
  /** Allows the identity to be passed as a raw OIDC claim set. */
  [key: string]: unknown
  sub: string
  email?: string
  name?: string
  dn42: {
    asn: number
    active_mnt: string
    mnt_by: string[]
    route?: string[]
    route6?: string[]
  }
}

/** CSCA realm administrator (`EXAMPLE-CSCA-MNT`). */
export const CSCA_ADMIN: TestIdentity = {
  sub: 'e2e-csca-admin',
  name: 'E2E CSCA Admin',
  email: 'csca-admin@example.net',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-CSCA-MNT',
    mnt_by: ['EXAMPLE-CSCA-MNT'],
  },
}

/** Ordinary CSCA applicant (`USER-MNT`). */
export const CSCA_USER: TestIdentity = {
  sub: 'e2e-csca-user',
  name: 'E2E CSCA User',
  email: 'csca-user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** A second ordinary maintainer, used for cross-tenant authorization checks. */
export const OTHER_USER: TestIdentity = {
  sub: 'e2e-other-user',
  name: 'E2E Other User',
  email: 'other@example.net',
  dn42: { asn: 4242420001, active_mnt: 'OTHER-MNT', mnt_by: ['OTHER-MNT'] },
}

/** A member of `USER-MNT` with a different subject (delegated review). */
export const USER_COLLEAGUE: TestIdentity = {
  sub: 'e2e-user-colleague',
  name: 'E2E User Colleague',
  email: 'colleague@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** DSC realm applicant (`USER-MNT`). */
export const DSC_USER: TestIdentity = {
  sub: 'e2e-dsc-user',
  email: 'user@example.net',
  name: 'E2E DSC User',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** DSC realm NIA administrator (`EXAMPLE-DSC-MNT`). */
export const DSC_ADMIN: TestIdentity = {
  sub: 'e2e-dsc-admin',
  name: 'E2E DSC Admin',
  email: 'dsc-admin@example.net',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-DSC-MNT',
    mnt_by: ['EXAMPLE-DSC-MNT'],
  },
}

/** CVCA realm applicant (`USER-MNT`). */
export const CVCA_USER: TestIdentity = {
  sub: 'e2e-cvca-user',
  name: 'E2E CVCA User',
  email: 'cvca-user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** CVCA realm administrator (`EXAMPLE-CVCA-MNT`). */
export const CVCA_ADMIN: TestIdentity = {
  sub: 'e2e-cvca-admin',
  name: 'E2E CVCA Admin',
  email: 'cvca-admin@example.net',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-CVCA-MNT',
    mnt_by: ['EXAMPLE-CVCA-MNT'],
  },
}

/** DV realm applicant (`USER-MNT`). */
export const DV_USER: TestIdentity = {
  sub: 'e2e-dv-user',
  name: 'E2E DV User',
  email: 'dv-user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** DV realm administrator (`EXAMPLE-DV-MNT`). */
export const DV_ADMIN: TestIdentity = {
  sub: 'e2e-dv-admin',
  name: 'E2E DV Admin',
  email: 'dv-admin@example.net',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-DV-MNT',
    mnt_by: ['EXAMPLE-DV-MNT'],
  },
}

/** Master List realm administrator (`EXAMPLE-ML-MNT`). */
export const ML_ADMIN: TestIdentity = {
  sub: 'e2e-ml-admin',
  name: 'E2E ML Admin',
  email: 'ml-admin@example.net',
  dn42: {
    asn: 4242422189,
    active_mnt: 'EXAMPLE-ML-MNT',
    mnt_by: ['EXAMPLE-ML-MNT'],
  },
}

/** An authenticated but non-administrator Master List user. */
export const ML_USER: TestIdentity = {
  sub: 'e2e-ml-user',
  name: 'E2E ML User',
  email: 'ml-user@example.net',
  dn42: { asn: 4242420000, active_mnt: 'USER-MNT', mnt_by: ['USER-MNT'] },
}

/** The fake OIDC provider client ids configured by `test-support.ts`. */
export const CLIENT_IDS = {
  csca: 'csca-client',
  cvca: 'cvca-client',
  dv: 'dv-client',
  dsc: 'dsc-client',
  ml: 'ml-client',
} as const

/** Full LDS1/LDS2 authorization used by the authorization-PKI tests. */
export const ALL_PERMISSIONS = {
  epassport: { dg3: true, dg4: true },
  travel: { read: true, write: true },
  visa: { read: true, write: true },
  biometrics: { read: true, write: true },
} as const

/** A travel-only authorization, used to prove clamping in terminal issuance. */
export const TRAVEL_ONLY = {
  epassport: { dg3: false, dg4: false },
  travel: { read: true, write: false },
  visa: { read: false, write: false },
  biometrics: { read: false, write: false },
} as const
