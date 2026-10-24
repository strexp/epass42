import { describe, expect, it } from 'vitest'

import { createCscaRoot, createDsc, generateRsaKeyPair } from '@epass42/pki'

import { clampNotAfter, effectiveValidity, privateKeyNotAfter, signerValidity } from './certificate'

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

describe('effective validity', () => {
  it('uses the earliest of the certificate, private key and issuer expiry', async () => {
    const dsc = await signer(new Date('2030-01-01T00:00:00Z'))
    const validity = effectiveValidity(
      {
        format: 'x509',
        notAfter: dsc.certificate.notAfter.toISOString(),
        certPem: dsc.pem,
        parentNotAfter: new Date('2027-01-01T00:00:00Z').toISOString(),
      },
      new Date('2026-06-01T00:00:00Z'),
    )
    expect(validity.certificateExpired).toBe(false)
    expect(validity.privateKeyExpired).toBe(false)
    expect(validity.parentExpired).toBe(false)
    expect(validity.expired).toBe(false)
    expect(validity.effectiveNotAfter).toBe('2027-01-01T00:00:00.000Z')
    expect(validity.daysRemaining).toBeGreaterThan(200)
  })

  it('treats an expired private-key period as unusable and reports that date', async () => {
    const dsc = await signer(new Date('2020-01-01T00:00:00Z'))
    const validity = effectiveValidity(
      {
        format: 'x509',
        notAfter: dsc.certificate.notAfter.toISOString(),
        certPem: dsc.pem,
      },
      new Date('2026-06-01T00:00:00Z'),
    )
    expect(validity.certificateExpired).toBe(false)
    expect(validity.privateKeyExpired).toBe(true)
    expect(validity.expired).toBe(true)
    expect(validity.effectiveNotAfter).toBe('2020-01-01T00:00:00.000Z')
  })

  it('does not invent a private-key period for CV certificates and fails closed on missing dates', () => {
    const valid = effectiveValidity(
      {
        format: 'cv',
        notAfter: '2030-01-01T00:00:00.000Z',
        parentNotAfter: '2029-01-01T00:00:00.000Z',
      },
      new Date('2026-01-01T00:00:00Z'),
    )
    expect(valid.privateKeyNotAfter).toBeNull()
    expect(valid.privateKeyExpired).toBe(false)
    expect(valid.effectiveNotAfter).toBe('2029-01-01T00:00:00.000Z')

    const missing = effectiveValidity({ format: 'cv', notAfter: null })
    expect(missing.expired).toBe(true)
    expect(missing.effectiveNotAfter).toBeNull()
  })

  it('treats a malformed X.509 private-key period as expired', () => {
    const validity = effectiveValidity({
      format: 'x509',
      notAfter: '2030-01-01T00:00:00.000Z',
      certPem: 'not a certificate',
    })
    expect(validity.privateKeyExpired).toBe(true)
    expect(validity.expired).toBe(true)
  })

  it('never extends a certificate beyond its issuer', () => {
    const parent = '2027-01-01T00:00:00.000Z'
    expect(clampNotAfter(new Date('2030-01-01T00:00:00Z'), parent).toISOString()).toBe(parent)
    expect(clampNotAfter(new Date('2026-01-01T00:00:00Z'), parent).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    expect(clampNotAfter(new Date('2030-01-01T00:00:00Z'), null).toISOString()).toBe(
      '2030-01-01T00:00:00.000Z',
    )
  })
})

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
