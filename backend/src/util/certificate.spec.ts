import { describe, expect, it } from 'vitest'

import { createCscaRoot, createDsc, generateRsaKeyPair } from '@epass42/pki'

import { privateKeyNotAfter, signerValidity } from './certificate'

const CRL_DP = ['ldap://epass42.local/c=XD']
const NOT_BEFORE = new Date('2026-01-01T00:00:00Z')
const NOT_AFTER = new Date('2036-01-01T00:00:00Z')

async function signer(privateKeyNotAfterDate: Date) {
  const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
  const csca = await createCscaRoot(
    {
      commonName: 'Test CSCA',
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
      privateKeyNotAfter: new Date('2030-01-01T00:00:00Z'),
      crlDistributionPoints: CRL_DP,
    },
    cscaKey,
  )
  const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
  return createDsc(
    {
      commonName: 'Test DSC',
      documentTypes: ['P'],
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
      privateKeyNotAfter: privateKeyNotAfterDate,
      crlDistributionPoints: CRL_DP,
    },
    dscKey,
    { certificate: csca.certificate, key: cscaKey },
  )
}

describe('signer validity', () => {
  it('treats an expired private key usage period as an expired signer', async () => {
    const dsc = await signer(new Date('2020-01-01T00:00:00Z'))
    expect(privateKeyNotAfter(dsc.pem)?.toISOString()).toBe('2020-01-01T00:00:00.000Z')
    const validity = signerValidity(dsc.certificate.notAfter.toISOString(), dsc.pem)
    expect(validity.certificateExpired).toBe(false)
    expect(validity.privateKeyExpired).toBe(true)
    expect(validity.expired).toBe(true)
  })

  it('keeps a signer usable while both periods are in the future', async () => {
    const dsc = await signer(new Date('2030-01-01T00:00:00Z'))
    const validity = signerValidity(dsc.certificate.notAfter.toISOString(), dsc.pem)
    expect(validity.expired).toBe(false)
  })
})
