import { describe, expect, it } from 'vitest'

import {
  certificatePolicy,
  publicCertificatePolicies,
  resolvePrivateKeyUsageDays,
  resolveValidityDays,
} from './policy'

describe('certificate validity policy', () => {
  it('uses the Doc 9303-12 limits for issued certificates', () => {
    expect(certificatePolicy('dsc')).toMatchObject({
      format: 'x509',
      ownership: 'issued',
      maxValidityDays: 3650,
      revocable: true,
      exportableKey: true,
    })
    expect(certificatePolicy('dsc').privateKeyUsage).toEqual({
      defaultDays: 90,
      maxDays: 92,
    })
    expect(certificatePolicy('lds2')).toMatchObject({
      maxValidityDays: 3760,
      privateKeyUsage: null,
    })
    expect(certificatePolicy('dv').maxValidityDays).toBe(92)
    expect(certificatePolicy('terminal').maxValidityDays).toBe(92)
    expect(certificatePolicy('cvca').format).toBe('cv')
  })

  it('resolves a requested validity, clamps the configured default and rejects out-of-range input', () => {
    expect(resolveValidityDays('dv', 30)).toBe(30)
    expect(resolveValidityDays('dv', undefined, 200)).toBe(92)
    expect(resolveValidityDays('dsc', undefined)).toBe(3650)
    expect(resolveValidityDays('lds2', 3760, 7300)).toBe(3760)
    expect(() => resolveValidityDays('dv', 0)).toThrow(/between 1 and 92/)
    expect(() => resolveValidityDays('dv', 93)).toThrow(/between 1 and 92/)
    expect(() => resolveValidityDays('dsc', 3651)).toThrow(/between 1 and 3650/)
  })

  it('only resolves a private-key usage period for kinds that carry one', () => {
    expect(resolvePrivateKeyUsageDays('dsc', undefined, 200)).toBe(92)
    expect(resolvePrivateKeyUsageDays('dsc', 30)).toBe(30)
    expect(resolvePrivateKeyUsageDays('lds2', 30)).toBeNull()
    expect(resolvePrivateKeyUsageDays('dv', 30)).toBeNull()
    expect(() => resolvePrivateKeyUsageDays('dsc', 93)).toThrow(/between 1 and 92/)
  })

  it('publishes the caps and configured defaults to the UI', () => {
    const policies = publicCertificatePolicies({
      csca: {
        niaDsc: { privateKeyUsageDays: 200 },
        lds2: { validityDays: 7300 },
      },
      cvca: { dv: { validityDays: 200 } },
    })
    expect(policies.dsc).toEqual({
      maxValidityDays: 3650,
      defaultValidityDays: 3650,
      maxPrivateKeyUsageDays: 92,
      defaultPrivateKeyUsageDays: 92,
    })
    expect(policies.lds2.defaultValidityDays).toBe(3760)
    expect(policies.dv.defaultValidityDays).toBe(92)
    expect(policies.terminal.maxValidityDays).toBe(92)
  })
})
