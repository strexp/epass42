import { describe, expect, it } from 'vitest'

import { parseConfig } from './config'

/**
 * The country codes are configured once, at the top level: `countryAlpha2` for
 * DN/PKD paths and `countryAlpha3` for the MRZ issuing state/nationality and
 * the CSCA SAN locality.  Nested defaults derive from them instead of
 * hard-coding a country.
 */
describe('country configuration', () => {
  it('derives the CSCA locality and CRL DP from the country codes', () => {
    const config = parseConfig({})
    expect(config.countryAlpha2).toBe('XD')
    expect(config.countryAlpha3).toBe('XDN')
    expect(config.csca.locality).toBe('XDN')
    expect(config.csca.crlDistributionPoints).toEqual(['ldap://epass42.local/c=XD'])
  })

  it('propagates a custom country code to every derived default', () => {
    const config = parseConfig({ countryAlpha2: 'ZZ', countryAlpha3: 'ZZZ' })
    expect(config.csca.locality).toBe('ZZZ')
    expect(config.csca.crlDistributionPoints).toEqual(['ldap://epass42.local/c=ZZ'])
  })

  it('has no separate issuing-state option; the country code is authoritative', () => {
    const config = parseConfig({ countryAlpha3: 'ZZZ' })
    expect(Object.keys(config.issuing)).not.toContain('issuingState')
    // An unknown `[issuing] issuingState` key is ignored rather than honoured.
    const withOverride = parseConfig({
      countryAlpha3: 'ZZZ',
      issuing: { issuingState: 'AAA' } as never,
    })
    expect(withOverride.countryAlpha3).toBe('ZZZ')
    expect((withOverride.issuing as Record<string, unknown>).issuingState).toBeUndefined()
  })

  it('lets an explicit nested CSCA value override the derived default', () => {
    const config = parseConfig({
      countryAlpha3: 'ZZZ',
      csca: { locality: 'SAN-CITY', crlDistributionPoints: ['https://example.net/crl.crl'] },
    })
    expect(config.csca.locality).toBe('SAN-CITY')
    expect(config.csca.crlDistributionPoints).toEqual(['https://example.net/crl.crl'])
  })

  it('rejects a country code of the wrong length', () => {
    expect(() => parseConfig({ countryAlpha3: 'TOOLONG' })).toThrow()
    expect(() => parseConfig({ countryAlpha2: 'X' })).toThrow()
  })
})

describe('ML configuration', () => {
  it('derives the signer subject from the CSCA profile', () => {
    const config = parseConfig({
      csca: { commonName: 'Example CSCA', organization: 'Example Org', organizationalUnit: 'PKI' },
      ml: { signer: { validityYears: 5 } },
    })
    expect(config.ml.signer.commonName).toBe('Example CSCA ML Signer')
    expect(config.ml.signer.organization).toBe('Example Org')
    expect(config.ml.signer.organizationalUnit).toBe('PKI')
    expect(config.ml.signer.validityYears).toBe(5)
    expect(config.ml.bootstrap).toBe(true)
  })

  it('keeps explicit ML signer values and defaults the administrator list', () => {
    const config = parseConfig({
      roles: ['pkd', 'ml'],
      ml: {
        bootstrap: false,
        signer: { commonName: 'Custom Signer', organization: 'Custom Org', algorithm: 'ecdsa' },
      },
    })
    expect(config.roles).toEqual(['pkd', 'ml'])
    expect(config.ml.bootstrap).toBe(false)
    expect(config.ml.signer.commonName).toBe('Custom Signer')
    expect(config.ml.signer.organization).toBe('Custom Org')
    expect(config.ml.signer.algorithm).toBe('ecdsa')
    expect(config.adminMnts.ml).toEqual([])
  })
})
