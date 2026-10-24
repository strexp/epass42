/**
 * Part 1 — certificate lifecycle cases that complement the main PKI suite:
 * CSCA link certificates, RSA-PSS chains, multi-entry CRLs, Master Lists over
 * several CSCAs, DocumentType coverage and restricted CV authorization.
 */
import { describe, expect, it } from 'vitest'

import {
  certificateCoversDocumentType,
  buildMasterList,
  createCscaRoot,
  createCscaLink,
  createCrl,
  createDsc,
  crlFingerprint,
  cvPublicKey,
  generateEcKeyPair,
  generateRsaKeyPair,
  isRevoked,
  parseCertificate,
  parseCvCertificate,
  parseCrl,
  readCrlNumber,
  validateCertProfile,
  verifyCvCertificate,
  verifyDscAgainstCsca,
  verifySod,
  buildSod,
  parseCertificatePem,
  sha256,
} from '@epass42/pki'
import { OIDS, type DvPermissions } from '@epass42/shared'

import { parseMasterList } from '../fixtures/cms'
import {
  CRL_DISTRIBUTION_POINTS,
  COUNTRY,
  issueCvChain,
  issueMasterListSigner,
  issueSignerChain,
  testValidity,
} from '../fixtures/certificates'

/** A profile-shaped CSCA subject and validity window. */
function cscaProfile(commonName: string) {
  const { notBefore, notAfter } = testValidity()
  return {
    commonName,
    country: COUNTRY,
    locality: 'XDN',
    notBefore,
    notAfter,
    privateKeyNotAfter: notAfter,
    crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
  }
}

describe('packages e2e — certificate lifecycle edge cases', () => {
  it('links a rolled-over CSCA key to the previous certificate', async () => {
    const { csca, cscaKey } = await issueSignerChain()
    const nextKey = await generateEcKeyPair('P-256')
    const profile = cscaProfile('E2E CSCA II')
    const link = await createCscaLink(csca.certificate, cscaKey, profile, nextKey.publicKey, false)
    const certificate = parseCertificate(link.der)

    expect(certificate.subject).toBe('CN=E2E CSCA II, C=XD')
    expect(certificate.issuer).toBe(csca.certificate.subject)
    expect(await certificate.verify({ publicKey: csca.certificate.publicKey })).toBe(true)
    expect(certificate.getExtension(OIDS.idIcaoNameChange)).toBeTruthy()
    expect(new Uint8Array(certificate.publicKey.rawData)).toEqual(nextKey.spki)
    expect(validateCertProfile(certificate, 'csca').valid).toBe(true)

    // A link certificate is not a new trust anchor; it does not chain to itself.
    expect(await certificate.verify({ publicKey: nextKey.publicKey })).toBe(false)
  })

  it('issues and verifies an RSA-PSS CSCA/DSC chain and EF.SOD', async () => {
    const { notBefore, notAfter } = testValidity()
    const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
    const csca = await createCscaRoot(
      {
        commonName: 'RSA-PSS CSCA',
        country: COUNTRY,
        locality: 'XDN',
        notBefore,
        notAfter,
        privateKeyNotAfter: notAfter,
        crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
        hash: 'SHA-256',
      },
      cscaKey,
    )
    const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
    const dsc = await createDsc(
      {
        commonName: 'RSA-PSS DSC',
        country: COUNTRY,
        documentTypes: ['P'],
        notBefore,
        notAfter,
        crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
      },
      { publicKey: dscKey.publicKey },
      { certificate: csca.certificate, key: cscaKey, hash: 'SHA-256' },
    )

    expect(validateCertProfile(csca.certificate, 'csca').valid).toBe(true)
    expect(validateCertProfile(dsc.certificate, 'dsc').valid).toBe(true)
    expect((await verifyDscAgainstCsca(dsc.certificate, [csca.certificate])).valid).toBe(true)

    const dg1 = new TextEncoder().encode('P<XDNRSA<<PSS<<<<<<<<<<<<<<<<<<<<<<<<<<<<')
    const sod = await buildSod(
      [{ number: 1, hash: sha256(dg1) }],
      dsc.der,
      dscKey.privateKey,
      'SHA-256',
    )
    const verified = await verifySod(sod, new Map([[1, dg1]]), [csca.certificate])
    expect(verified.errors).toEqual([])
    expect(verified.valid).toBe(true)
  })

  it('publishes multiple revocations in a monotonic CRL sequence', async () => {
    const { csca, cscaKey, dsc, dscKey } = await issueSignerChain()
    const second = await createDsc(
      { ...cscaProfile('E2E DSC II'), documentTypes: ['P'], locality: 'XDN' },
      { publicKey: dscKey.publicKey },
      { certificate: csca.certificate, key: cscaKey },
    )
    const now = new Date()
    const nextUpdate = new Date(now.getTime() + 30 * 86_400_000)

    const firstCrl = await createCrl({
      issuerCertificate: csca.certificate,
      signingKey: cscaKey,
      crlNumber: 11n,
      thisUpdate: now,
      nextUpdate,
      entries: [
        { serialHex: dsc.serialHex, revocationDate: now },
        { serialHex: second.serialHex, revocationDate: now },
      ],
    })
    const parsedFirst = parseCrl(firstCrl.der)
    expect(await parsedFirst.verify({ publicKey: csca.certificate.publicKey })).toBe(true)
    expect(readCrlNumber(parsedFirst)).toBe(11n)
    expect(crlFingerprint(parsedFirst)).toMatch(/^[0-9a-f]{64}$/i)
    expect(isRevoked(parsedFirst, dsc.serialHex)).not.toBeNull()
    expect(isRevoked(parsedFirst, second.serialHex)).not.toBeNull()

    const secondCrl = await createCrl({
      issuerCertificate: csca.certificate,
      signingKey: cscaKey,
      crlNumber: 12n,
      thisUpdate: new Date(now.getTime() + 1000),
      nextUpdate,
      entries: [{ serialHex: second.serialHex, revocationDate: now }],
    })
    const parsedSecond = parseCrl(secondCrl.der)
    expect(readCrlNumber(parsedSecond)).toBe(12n)
    expect(isRevoked(parsedSecond, second.serialHex)).not.toBeNull()
    expect(isRevoked(parsedSecond, dsc.serialHex)).toBeNull()
  })

  it('includes each CSCA once in a Master List over several roots', async () => {
    const first = await issueSignerChain()
    const second = await issueSignerChain('Other DSC')
    const signer = await issueMasterListSigner(first.csca, first.cscaKey)

    const der = await buildMasterList({
      cscaCertificates: [
        first.csca.der,
        second.csca.der,
        // A duplicate must not inflate the SET.
        first.csca.der,
      ],
      signerCertificate: signer.certificate.der,
      signerPrivateKey: signer.key.privateKey,
    })
    const masterList = await parseMasterList(der)
    expect(masterList.signatureValid).toBe(true)
    expect(masterList.signerCount).toBe(1)
    expect(masterList.certificateCount).toBe(3)
  })

  it('applies DocumentType coverage including the I wildcard', async () => {
    const { csca, cscaKey, dsc } = await issueSignerChain()
    const wildcard = parseCertificatePem(dsc.pem)
    expect(certificateCoversDocumentType(wildcard, 'P')).toBe(true)
    expect(certificateCoversDocumentType(wildcard, 'ID')).toBe(true)
    expect(certificateCoversDocumentType(wildcard, 'IP')).toBe(true)

    const passportOnly = await createDsc(
      { ...cscaProfile('Passport Only'), documentTypes: ['P'], locality: 'XDN' },
      { publicKey: (await generateEcKeyPair('P-256')).publicKey },
      { certificate: csca.certificate, key: cscaKey },
    )
    const parsed = parseCertificate(passportOnly.der)
    expect(certificateCoversDocumentType(parsed, 'P')).toBe(true)
    expect(certificateCoversDocumentType(parsed, 'ID')).toBe(false)
  })

  it('verifies a restricted CVCA → DV → terminal authorization', async () => {
    const permissions: DvPermissions = {
      epassport: { dg3: true, dg4: false },
      travel: { read: true, write: false },
      visa: { read: false, write: false },
      biometrics: { read: false, write: false },
    }
    const { cvca, dv, terminal } = await issueCvChain(permissions)
    const cvcaCert = parseCvCertificate(cvca.der)
    const dvCert = parseCvCertificate(dv.der)
    const terminalCert = parseCvCertificate(terminal.der)

    expect(dvCert.permissions).toEqual(permissions)
    expect(terminalCert.permissions).toEqual(permissions)
    expect(await verifyCvCertificate(dvCert, await cvPublicKey(cvcaCert))).toBe(true)
    expect(await verifyCvCertificate(terminalCert, await cvPublicKey(dvCert))).toBe(true)
    expect(terminalCert.authorityReference).toBe(dvCert.holderReference)
    expect(terminalCert.role).toBe('terminal')
  })
})
