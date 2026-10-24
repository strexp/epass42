/**
 * Part 1 — package-level end-to-end tests.
 *
 * Everything here uses `@epass42/pki` (and `pkijs` for CMS inspection) on its
 * own: no backend, no HTTP, no filesystem writes.  The suite exercises the full
 * Doc 9303-12 object lifecycle: certificate issuance, revocation, EF.SOD
 * signing, CSCA Master Lists and terminal (CV) authorization chains.
 */
import { describe, expect, it } from 'vitest'
import * as pkijs from 'pkijs'

import {
  CMS_OIDS,
  buildMasterList,
  buildSod,
  createCrl,
  crlFingerprint,
  cvPublicKey,
  isRevoked,
  parseCertificatePem,
  parseCrl,
  parseCvCertificate,
  readCrlNumber,
  sha256,
  toArrayBuffer,
  validateCertProfile,
  verifyCvCertificate,
  verifyDscAgainstCsca,
  verifySod,
} from '@epass42/pki'

import {
  ALL_PERMISSIONS,
  issueCvChain,
  issueLds2Signer,
  issueMasterListSigner,
  issueSignerChain,
} from '../fixtures/certificates'
import { dg2Jpeg } from '../fixtures/documents'

const utf8 = new TextEncoder()

describe('packages e2e — Doc 9303-12 PKI lifecycle', () => {
  it('issues a profile-conforming CSCA and a DSC chained to it', async () => {
    const { csca, dsc } = await issueSignerChain()

    const cscaProfile = validateCertProfile(csca.certificate, 'csca')
    expect(cscaProfile.errors).toEqual([])
    expect(cscaProfile.valid).toBe(true)

    const dscProfile = validateCertProfile(dsc.certificate, 'dsc')
    expect(dscProfile.errors).toEqual([])
    expect(dscProfile.valid).toBe(true)

    const chain = await verifyDscAgainstCsca(dsc.certificate, [csca.certificate])
    expect(chain.errors).toEqual([])
    expect(chain.valid).toBe(true)

    // The PEM/DER encodings are interchangeable.
    expect(parseCertificatePem(csca.pem).serialNumber).toBe(csca.serialHex)
    expect(csca.der[0]).toBe(0x30)
  })

  it('revokes a DSC through a signed CRL', async () => {
    const { csca, cscaKey, dsc } = await issueSignerChain()
    const thisUpdate = new Date()
    const nextUpdate = new Date(thisUpdate.getTime() + 30 * 24 * 60 * 60 * 1000)

    const generated = await createCrl({
      issuerCertificate: csca.certificate,
      signingKey: cscaKey,
      crlNumber: 7n,
      thisUpdate,
      nextUpdate,
      entries: [{ serialHex: dsc.serialHex, revocationDate: thisUpdate }],
    })

    const crl = parseCrl(generated.der)
    expect(await crl.verify({ publicKey: csca.certificate.publicKey })).toBe(true)
    expect(readCrlNumber(crl)).toBe(7n)
    expect(crlFingerprint(crl)).toMatch(/^[0-9a-f]{64}$/i)
    expect(isRevoked(crl, dsc.serialHex)).not.toBeNull()
  })

  it('signs EF.SOD over data-group hashes and detects tampering', async () => {
    const { csca, dsc, dscKey } = await issueSignerChain()
    const dg1 = utf8.encode('P<XDNERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<<<<<')
    const dg2 = dg2Jpeg()
    const hashes = [
      { number: 1, hash: sha256(dg1) },
      { number: 2, hash: sha256(dg2) },
    ]

    const sod = await buildSod(hashes, dsc.der, dscKey.privateKey)
    const valid = await verifySod(
      sod,
      new Map([
        [1, dg1],
        [2, dg2],
      ]),
      [csca.certificate],
    )
    expect(valid.errors).toEqual([])
    expect(valid.valid).toBe(true)
    expect(valid.signerCertificate?.subject).toContain('E2E DSC')

    const tampered = await verifySod(
      sod,
      new Map([
        [1, utf8.encode('P<XDNTAMPERED<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<<<<<')],
        [2, dg2],
      ]),
      [csca.certificate],
    )
    expect(tampered.valid).toBe(false)
    expect(tampered.mismatchedDataGroups).toEqual([1])
  })

  it('builds a CSCA Master List signed by a Master List Signer', async () => {
    const { csca, cscaKey } = await issueSignerChain()
    const signer = await issueMasterListSigner(csca, cscaKey)
    const masterList = await buildMasterList({
      cscaCertificates: [csca.der],
      signerCertificate: signer.certificate.der,
      signerPrivateKey: signer.key.privateKey,
    })

    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(masterList))
    expect(contentInfo.contentType).toBe(CMS_OIDS.signedData)
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })
    expect(signedData.encapContentInfo.eContentType).toBe(CMS_OIDS.cscaMasterList)

    const eContent = signedData.encapContentInfo.eContent
    if (!eContent) throw new Error('Master List has no eContent')
    const eContentBytes = new Uint8Array(eContent.valueBlock.valueHexView)
    expect(
      await signedData.verify({
        signer: 0,
        data: toArrayBuffer(eContentBytes),
        checkChain: false,
      }),
    ).toBe(true)
  })

  it('issues and verifies a CVCA → DV → terminal authorization chain', async () => {
    const { cvca, dv, terminal } = await issueCvChain()

    const cvcaCert = parseCvCertificate(cvca.der)
    const dvCert = parseCvCertificate(dv.der)
    const terminalCert = parseCvCertificate(terminal.der)

    expect(await verifyCvCertificate(dvCert, await cvPublicKey(cvcaCert))).toBe(true)
    expect(await verifyCvCertificate(terminalCert, await cvPublicKey(dvCert))).toBe(true)
    expect(dvCert.role).toBe('dv')
    expect(terminalCert.role).toBe('terminal')
    expect(terminalCert.permissions).toEqual(ALL_PERMISSIONS)
  })

  it('issues an LDS2 Signer with the profile and chain of Doc 9303-12 §7.1.2', async () => {
    const { csca, cscaKey } = await issueSignerChain()
    const lds2 = await issueLds2Signer(csca, cscaKey)

    const profile = validateCertProfile(lds2.certificate, 'lds2-signer')
    expect(profile.errors).toEqual([])
    expect(profile.valid).toBe(true)

    const chain = await verifyDscAgainstCsca(lds2.certificate, [csca.certificate], 'lds2-signer')
    expect(chain.errors).toEqual([])
    expect(chain.valid).toBe(true)
  })
})
