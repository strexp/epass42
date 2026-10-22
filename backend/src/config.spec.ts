import { describe, expect, it } from 'vitest'

import { parseConfig } from './config'

/**
 * The country codes are configured once, at the top level: `countryAlpha2` for
 * DN/PKD paths and `countryAlpha3` for the MRZ and the CSCA SAN locality.
 * Nested defaults derive from them instead of hard-coding a country.
 */
describe('country configuration', () => {
  it('derives the CSCA locality, issuing state and CRL DP from the country codes', () => {
    const config = parseConfig({})
    expect(config.countryAlpha2).toBe('XD')
    expect(config.countryAlpha3).toBe('XDN')
    expect(config.csca.locality).toBe('XDN')
    expect(config.issuing.issuingState).toBe('XDN')
    expect(config.csca.crlDistributionPoints).toEqual(['ldap://epass42.local/c=XD'])
  })

  it('propagates a custom country code to every derived default', () => {
    const config = parseConfig({ countryAlpha2: 'ZZ', countryAlpha3: 'ZZZ' })
    expect(config.csca.locality).toBe('ZZZ')
    expect(config.issuing.issuingState).toBe('ZZZ')
    expect(config.csca.crlDistributionPoints).toEqual(['ldap://epass42.local/c=ZZ'])
  })

  it('lets an explicit nested value override the derived default', () => {
    const config = parseConfig({
      countryAlpha3: 'ZZZ',
      csca: { locality: 'SAN-CITY', crlDistributionPoints: ['https://example.net/crl.crl'] },
      issuing: { issuingState: 'AAA' },
    })
    expect(config.csca.locality).toBe('SAN-CITY')
    expect(config.issuing.issuingState).toBe('AAA')
    expect(config.csca.crlDistributionPoints).toEqual(['https://example.net/crl.crl'])
  })

  it('rejects a country code of the wrong length', () => {
    expect(() => parseConfig({ countryAlpha3: 'TOOLONG' })).toThrow()
    expect(() => parseConfig({ countryAlpha2: 'X' })).toThrow()
  })
})
