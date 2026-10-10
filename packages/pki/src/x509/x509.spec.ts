import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { generateRsaKeyPair } from '../crypto/crypto'
import { createCscaRoot, createDsc } from './x509'
import { createCrl, readCrlNumber } from './crl'
import { OIDS } from '@epass42/shared'
import * as x509 from './x509lib'

const CRL_DP = ['ldap://epass42.local/c=XD', 'https://epass42.local/crl/csca.crl']

function dates() {
  const notBefore = new Date('2026-01-01T00:00:00Z')
  const notAfter = new Date('2039-01-01T00:00:00Z')
  const keyNotAfter = new Date('2031-01-01T00:00:00Z')
  return { notBefore, notAfter, keyNotAfter }
}

describe('X.509 CSCA profile', () => {
  it('builds a conforming RSA-PSS CSCA root', async () => {
    const key = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
    const { notBefore, notAfter, keyNotAfter } = dates()
    const generated = await createCscaRoot(
      {
        commonName: 'ePass 42 Test CSCA',
        notBefore,
        notAfter,
        privateKeyNotAfter: keyNotAfter,
        crlDistributionPoints: CRL_DP,
        pss: true,
      },
      key,
    )
    const cert = generated.certificate

    expect(cert.signatureAlgorithm.name).toBe('RSA-PSS')
    expect(cert.getExtension(OIDS.subjectKeyIdentifier)).toBeTruthy()
    expect(cert.getExtension(OIDS.authorityKeyIdentifier)).toBeTruthy()
    expect(cert.getExtension(OIDS.privateKeyUsagePeriod)).toBeTruthy()
    expect(cert.getExtension(OIDS.subjectAltName)).toBeTruthy()
    expect(cert.getExtension(OIDS.issuerAltName)).toBeTruthy()
    expect(cert.getExtension(OIDS.cRLDistributionPoints)).toBeTruthy()
    expect(cert.getExtension(OIDS.extKeyUsage)).toBeFalsy()

    const ku = cert.getExtension<x509.KeyUsagesExtension>(OIDS.keyUsage)
    expect(ku?.critical).toBe(true)
    expect(ku?.usages).toBe(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign)

    const bc = cert.getExtension<x509.BasicConstraintsExtension>(OIDS.basicConstraints)
    expect(bc?.critical).toBe(true)
    expect(bc?.ca).toBe(true)
    expect(bc?.pathLength).toBe(0)

    // Self-verifies.
    expect(await cert.verify({ publicKey: key.publicKey, signatureOnly: true })).toBe(true)

    mkdirSync('/tmp/opencode/pki', { recursive: true })
    writeFileSync('/tmp/opencode/pki/csca.crt', generated.pem)
  })

  it('builds a DSC certificate signed by the CSCA', async () => {
    const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const { notBefore, notAfter } = dates()
    const csca = await createCscaRoot(
      {
        commonName: 'ePass 42 Test CSCA',
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
        pss: false,
      },
      cscaKey,
    )
    const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const dsc = await createDsc(
      {
        commonName: 'ePass 42 Test DSC',
        country: 'XD',
        organization: 'ePass 42',
        organizationalUnit: 'PKI',
        documentTypes: ['P'],
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
        pss: false,
      },
      dscKey,
      { certificate: csca.certificate, key: cscaKey },
    )
    const cert = dsc.certificate
    // O/OU are populated so the subject matches common ICAO PKD practice.
    expect(cert.subject).toContain('O=ePass 42')
    expect(cert.subject).toContain('OU=PKI')
    expect(cert.subject).toContain('CN=ePass 42 Test DSC')
    expect(cert.getExtension(OIDS.idIcaoDocumentType)).toBeTruthy()
    expect(cert.getExtension(OIDS.basicConstraints)).toBeFalsy()
    expect(cert.getExtension(OIDS.extKeyUsage)).toBeFalsy()
    const ku = cert.getExtension<x509.KeyUsagesExtension>(OIDS.keyUsage)
    expect(ku?.usages).toBe(x509.KeyUsageFlags.digitalSignature)
    expect(await cert.verify({ publicKey: cscaKey.publicKey, signatureOnly: true })).toBe(true)

    writeFileSync('/tmp/opencode/pki/csca2.crt', csca.pem)
    writeFileSync('/tmp/opencode/pki/dsc.crt', dsc.pem)
  })
})

describe('CRL profile', () => {
  it('creates and reads back a CRL with a crlNumber', async () => {
    const key = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const { notBefore, notAfter } = dates()
    const csca = await createCscaRoot(
      {
        commonName: 'ePass 42 Test CSCA',
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
        pss: false,
      },
      key,
    )
    const generated = await createCrl({
      issuerCertificate: csca.certificate,
      signingKey: key,
      crlNumber: 7,
      thisUpdate: new Date('2026-02-01T00:00:00Z'),
      nextUpdate: new Date('2026-03-01T00:00:00Z'),
      entries: [],
      pss: false,
    })
    expect(readCrlNumber(generated.crl)).toBe(7n)
    expect(generated.crl.getExtension(OIDS.authorityKeyIdentifier)).toBeTruthy()
    expect(await generated.crl.verify({ publicKey: key.publicKey })).toBe(true)
  })
})
