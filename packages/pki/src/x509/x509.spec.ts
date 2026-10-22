import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { generateEcKeyPair, generateRsaKeyPair } from '../crypto/crypto'
import { createCscaRoot, createDsc, createLds2Signer } from './x509'
import {
  certificateCoversDocumentType,
  documentTypeExtension,
  documentTypesOfCertificate,
} from './profile'
import { createCrl, readCrlNumber } from './crl'
import { validateCertProfile, verifyDscAgainstCsca } from '../verify/verify'
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

  it('builds an LDS2 Signer with only AKI and a critical EKU', async () => {
    const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const { notBefore, notAfter } = dates()
    const csca = await createCscaRoot(
      {
        commonName: 'ePass 42 LDS2 CSCA',
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
        pss: false,
      },
      cscaKey,
    )
    // LDS2 Signers MUST use ECDSA (Doc 9303-12 §4.1.7), even when the CSCA is RSA.
    const signerKey = await generateEcKeyPair('P-256')
    const signer = await createLds2Signer(
      {
        commonName: 'LDS2TS',
        lds2Types: ['ts', 'v'],
        notBefore,
        notAfter,
      },
      { publicKey: signerKey.publicKey },
      { certificate: csca.certificate, key: cscaKey },
    )
    const cert = signer.certificate

    // Subject: only C and CN (CN ≤ 9 characters), no O/OU/SAN.
    expect(cert.subject).toBe('CN=LDS2TS, C=XD')
    expect(cert.getExtension(OIDS.subjectAltName)).toBeFalsy()
    expect(cert.getExtension(OIDS.issuerAltName)).toBeFalsy()
    expect(cert.getExtension(OIDS.subjectKeyIdentifier)).toBeFalsy()
    expect(cert.getExtension(OIDS.keyUsage)).toBeFalsy()
    expect(cert.getExtension(OIDS.basicConstraints)).toBeFalsy()
    expect(cert.getExtension(OIDS.idIcaoDocumentType)).toBeFalsy()
    expect(cert.getExtension(OIDS.cRLDistributionPoints)).toBeFalsy()

    const eku = cert.getExtension<x509.ExtendedKeyUsageExtension>(OIDS.extKeyUsage)
    expect(eku?.critical).toBe(true)
    expect(eku?.usages).toEqual([OIDS.lds2TsSigner, OIDS.lds2VisaSigner])
    expect(cert.signatureAlgorithm.name).toBe('RSASSA-PKCS1-v1_5')
    expect(await cert.verify({ publicKey: cscaKey.publicKey, signatureOnly: true })).toBe(true)

    // The profile validator accepts it and the chain reaches the CSCA.
    expect(validateCertProfile(cert, 'lds2-signer')).toEqual({ valid: true, errors: [] })
    const chain = await verifyDscAgainstCsca(cert, [csca.certificate], 'lds2-signer')
    expect(chain.valid).toBe(true)

    // RSA subject keys are rejected: LDS2 Signers must be ECDSA.
    const rsaSignerKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    await expect(
      createLds2Signer(
        { commonName: 'LDS2B', lds2Types: ['b'], notBefore, notAfter },
        { publicKey: rsaSignerKey.publicKey },
        { certificate: csca.certificate, key: cscaKey },
      ),
    ).rejects.toThrow(/ECDSA/)
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
    })
    expect(readCrlNumber(generated.crl)).toBe(7n)
    expect(generated.crl.getExtension(OIDS.authorityKeyIdentifier)).toBeTruthy()
    expect(await generated.crl.verify({ publicKey: key.publicKey })).toBe(true)
  })

  it('builds an ECDSA CSCA, DSC and CRL', async () => {
    const { notBefore, notAfter, keyNotAfter } = dates()
    const cscaKey = await generateEcKeyPair('P-256')
    const csca = await createCscaRoot(
      {
        commonName: 'ePass 42 EC CSCA',
        notBefore,
        notAfter,
        privateKeyNotAfter: keyNotAfter,
        crlDistributionPoints: CRL_DP,
      },
      cscaKey,
    )
    expect(csca.certificate.signatureAlgorithm.name).toBe('ECDSA')
    expect(
      await csca.certificate.verify({ publicKey: cscaKey.publicKey, signatureOnly: true }),
    ).toBe(true)

    const dscKey = await generateEcKeyPair('P-384')
    const dsc = await createDsc(
      {
        commonName: 'ePass 42 EC DSC',
        documentTypes: ['P'],
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
      },
      { publicKey: dscKey.publicKey },
      { certificate: csca.certificate, key: cscaKey },
    )
    expect(dsc.certificate.signatureAlgorithm.name).toBe('ECDSA')
    expect(
      await dsc.certificate.verify({ publicKey: cscaKey.publicKey, signatureOnly: true }),
    ).toBe(true)

    const crl = await createCrl({
      issuerCertificate: csca.certificate,
      signingKey: cscaKey,
      crlNumber: 9,
      thisUpdate: new Date('2026-02-01T00:00:00Z'),
      nextUpdate: new Date('2026-03-01T00:00:00Z'),
      entries: [],
    })
    expect(readCrlNumber(crl.crl)).toBe(9n)
    expect(await crl.crl.verify({ publicKey: cscaKey.publicKey })).toBe(true)
  })
})

describe('DocumentType extension', () => {
  it('encodes the I wildcard alongside P in DER order and covers ID/IP', async () => {
    const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const { notBefore, notAfter, keyNotAfter } = dates()
    const csca = await createCscaRoot(
      {
        commonName: 'ePass 42 Type CSCA',
        notBefore,
        notAfter,
        privateKeyNotAfter: keyNotAfter,
        crlDistributionPoints: CRL_DP,
      },
      cscaKey,
    )
    const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const dsc = await createDsc(
      {
        commonName: 'ePass 42 P+I DSC',
        documentTypes: ['P', 'I'],
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
      },
      dscKey,
      { certificate: csca.certificate, key: cscaKey },
    )
    const extension = dsc.certificate.getExtension(OIDS.idIcaoDocumentType)
    expect(extension?.critical).toBe(false)
    // DER SET OF orders the shortest encoding first: "I" (13 01 49) < "P" (13 01 50).
    expect(documentTypesOfCertificate(dsc.certificate)).toEqual(['I', 'P'])
    expect(certificateCoversDocumentType(dsc.certificate, 'P')).toBe(true)
    expect(certificateCoversDocumentType(dsc.certificate, 'ID')).toBe(true)
    expect(certificateCoversDocumentType(dsc.certificate, 'IP')).toBe(true)

    const pOnly = await createDsc(
      {
        commonName: 'ePass 42 P-only DSC',
        documentTypes: ['P'],
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DP,
      },
      dscKey,
      { certificate: csca.certificate, key: cscaKey },
    )
    expect(certificateCoversDocumentType(pOnly.certificate, 'P')).toBe(true)
    expect(certificateCoversDocumentType(pOnly.certificate, 'ID')).toBe(false)
  })

  it('rejects empty, unknown and oversized type lists', () => {
    expect(() => documentTypeExtension([])).toThrow()
    expect(() => documentTypeExtension(['X'])).toThrow()
    expect(() => documentTypeExtension(['P', 'ID', 'IP'])).toThrow()
    // Duplicates collapse to a single SET OF member.
    expect(() => documentTypeExtension(['P', 'P'])).not.toThrow()
  })
})
