/**
 * Certificate validity policy (P0).
 *
 * Every certificate kind has one authoritative set of limits: how long the
 * certificate may live, whether it also carries a PrivateKeyUsagePeriod, and
 * whether it can be revoked/exported.  Routes, services and the public runtime
 * configuration all read the policy from here, so UI limits and server checks
 * cannot drift apart.
 *
 * The values follow Doc 9303-12:
 * - CSCA: 13-year public key, 4-year private key usage period (§7.1.1 Table 6).
 * - DSC: 10-year public key, 3-month private key usage period (§7.1.1 Table 6).
 * - LDS2 Signer: 10 years + 3 months (§7.1.2).
 * - CVCA: at most 36 months (§4.2).
 * - DV: at most 3 months (§7.2.2).
 * - Terminal (IS): at most 3 months, and never beyond its signing DV.
 * - ML Signer: CSCA-issued signer with a 10-year default (§9).
 */
import { AppError } from '@epass42/shared'

import type { CertificateFormat } from '../util/certificate'

export const CERTIFICATE_KINDS = [
  'csca',
  'dsc',
  'lds2',
  'ml-signer',
  'cvca',
  'dv',
  'terminal',
] as const

export type CertificateKind = (typeof CERTIFICATE_KINDS)[number]

/** Whether a certificate is held by this service or issued to an applicant. */
export type CertificateOwnership = 'hosted' | 'issued'

/** The policy of one certificate kind. */
export interface CertificatePolicy {
  kind: CertificateKind
  format: CertificateFormat
  ownership: CertificateOwnership
  /** Maximum accepted validity in days. */
  maxValidityDays: number
  /** Default validity in days when the applicant omits it. */
  defaultValidityDays: number
  /** PrivateKeyUsagePeriod limits, or null when the profile has none. */
  privateKeyUsage: { defaultDays: number; maxDays: number } | null
  revocable: boolean
  /** Whether an owned private key may be exported once. */
  exportableKey: boolean
  /** The certificate that signs this kind, or null for a self-signed root. */
  parent: 'csca' | 'cvca' | 'dv' | null
}

/** The authoritative policy for each certificate kind. */
export const CERTIFICATE_POLICIES: Record<CertificateKind, CertificatePolicy> = {
  csca: {
    kind: 'csca',
    format: 'x509',
    ownership: 'hosted',
    maxValidityDays: 30 * 365,
    defaultValidityDays: 13 * 365,
    privateKeyUsage: { defaultDays: 4 * 365, maxDays: 10 * 365 },
    revocable: false,
    exportableKey: false,
    parent: null,
  },
  dsc: {
    kind: 'dsc',
    format: 'x509',
    ownership: 'issued',
    maxValidityDays: 10 * 365,
    defaultValidityDays: 10 * 365,
    privateKeyUsage: { defaultDays: 90, maxDays: 92 },
    revocable: true,
    exportableKey: true,
    parent: 'csca',
  },
  lds2: {
    kind: 'lds2',
    format: 'x509',
    ownership: 'issued',
    // Doc 9303-12 Table 1: 10 years plus three months.
    maxValidityDays: 3760,
    defaultValidityDays: 3760,
    privateKeyUsage: null,
    revocable: true,
    exportableKey: true,
    parent: 'csca',
  },
  'ml-signer': {
    kind: 'ml-signer',
    format: 'x509',
    ownership: 'hosted',
    maxValidityDays: 30 * 365,
    defaultValidityDays: 10 * 365,
    privateKeyUsage: null,
    revocable: false,
    exportableKey: false,
    parent: 'csca',
  },
  cvca: {
    kind: 'cvca',
    format: 'cv',
    ownership: 'hosted',
    // The profile caps the CVCA at 36 months; use 31-day months for the cap.
    maxValidityDays: 36 * 31,
    defaultValidityDays: 36 * 30,
    privateKeyUsage: null,
    revocable: false,
    exportableKey: false,
    parent: null,
  },
  dv: {
    kind: 'dv',
    format: 'cv',
    ownership: 'issued',
    maxValidityDays: 92,
    defaultValidityDays: 90,
    privateKeyUsage: null,
    revocable: false,
    exportableKey: true,
    parent: 'cvca',
  },
  terminal: {
    kind: 'terminal',
    format: 'cv',
    ownership: 'issued',
    maxValidityDays: 92,
    defaultValidityDays: 90,
    privateKeyUsage: null,
    revocable: false,
    exportableKey: true,
    parent: 'dv',
  },
}

/** The policy of a certificate kind. */
export function certificatePolicy(kind: CertificateKind): CertificatePolicy {
  return CERTIFICATE_POLICIES[kind]
}

/**
 * Resolves the effective validity: the applicant's request, clamped to the
 * policy maximum, or the configured default (itself clamped by the policy).
 */
export function resolveValidityDays(
  kind: CertificateKind,
  requested: number | null | undefined,
  configuredDefault?: number,
): number {
  const policy = certificatePolicy(kind)
  const fallback = Math.min(configuredDefault ?? policy.defaultValidityDays, policy.maxValidityDays)
  const days = requested ?? fallback
  if (!Number.isInteger(days) || days < 1 || days > policy.maxValidityDays) {
    throw new AppError(
      'bad_request',
      `${kind} validity must be between 1 and ${policy.maxValidityDays} days`,
      400,
    )
  }
  return days
}

/** Resolves a private-key usage period for a kind that carries one. */
export function resolvePrivateKeyUsageDays(
  kind: CertificateKind,
  requested: number | null | undefined,
  configuredDefault?: number,
): number | null {
  const policy = certificatePolicy(kind)
  if (!policy.privateKeyUsage) return null
  const fallback = Math.min(
    configuredDefault ?? policy.privateKeyUsage.defaultDays,
    policy.privateKeyUsage.maxDays,
  )
  const days = requested ?? fallback
  if (!Number.isInteger(days) || days < 1 || days > policy.privateKeyUsage.maxDays) {
    throw new AppError(
      'bad_request',
      `${kind} private-key usage must be between 1 and ${policy.privateKeyUsage.maxDays} days`,
      400,
    )
  }
  return days
}

/** The public subset exposed through `GET /api/config`. */
export function publicCertificatePolicies(config: {
  csca: { niaDsc: { privateKeyUsageDays: number }; lds2: { validityDays: number } }
  cvca: { dv: { validityDays: number } }
}): Record<
  'dsc' | 'lds2' | 'dv' | 'terminal',
  {
    maxValidityDays: number
    defaultValidityDays: number
    maxPrivateKeyUsageDays: number | null
    defaultPrivateKeyUsageDays: number | null
  }
> {
  const entry = (kind: CertificateKind, configuredDefault: number) => {
    const policy = certificatePolicy(kind)
    return {
      maxValidityDays: policy.maxValidityDays,
      defaultValidityDays: Math.min(configuredDefault, policy.maxValidityDays),
      maxPrivateKeyUsageDays: policy.privateKeyUsage?.maxDays ?? null,
      defaultPrivateKeyUsageDays: policy.privateKeyUsage
        ? Math.min(config.csca.niaDsc.privateKeyUsageDays, policy.privateKeyUsage.maxDays)
        : null,
    }
  }
  return {
    dsc: entry('dsc', certificatePolicy('dsc').defaultValidityDays),
    lds2: entry('lds2', config.csca.lds2.validityDays),
    dv: entry('dv', config.cvca.dv.validityDays),
    terminal: entry('terminal', config.cvca.dv.validityDays),
  }
}
