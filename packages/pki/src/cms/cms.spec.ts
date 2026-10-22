import { describe, expect, it } from 'vitest'
import * as pkijs from 'pkijs'

import { toArrayBuffer } from '../codec/bytes'
import { buildCardSecurity, buildSod, CMS_OIDS, ldsSecurityObject } from './cms'
import { buildMasterList, masterListContent } from './masterList'
import { generateRsaKeyPair, sha256 } from '../crypto/crypto'
import { createMasterListSigner } from '../x509/x509'
import { verifySod } from '../verify/verify'
import { createTestCa, createTestDsc, TEST_CRL_DP, TEST_DATES } from '../testing'

describe('LDS Security Object', () => {
  it('sorts data group entries by number', () => {
    const object = ldsSecurityObject([
      { number: 15, hash: new Uint8Array([0xaa]) },
      { number: 1, hash: new Uint8Array([0xbb]) },
    ])
    const hex = Buffer.from(object).toString('hex').toUpperCase()
    expect(hex).toContain('0609608648016503040201')
    expect(hex.indexOf('02010F')).toBeGreaterThan(hex.indexOf('020101'))
  })
})

describe('EF.SOD', () => {
  it('builds a CMS SignedData wrapped in the 77 tag and verifies it', async () => {
    const ca = await createTestCa()
    const dsc = await createTestDsc(ca)
    const dg1 = new Uint8Array([1, 2, 3, 4])
    const dg2 = new Uint8Array([5, 6, 7, 8])
    const sod = await buildSod(
      [
        { number: 1, hash: sha256(dg1) },
        { number: 2, hash: sha256(dg2) },
      ],
      dsc.der,
      dsc.key.privateKey,
    )
    expect(sod[0]).toBe(0x77)

    const result = await verifySod(sod, new Map([[1, dg1]]), [ca.certificate])
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.signerCertificate?.subject).toContain('ePass 42 Test DSC')
  })

  it('detects a data group hash mismatch', async () => {
    const ca = await createTestCa()
    const dsc = await createTestDsc(ca)
    const dg1 = new Uint8Array([1, 2, 3, 4])
    const sod = await buildSod([{ number: 1, hash: sha256(dg1) }], dsc.der, dsc.key.privateKey)
    const result = await verifySod(sod, new Map([[1, new Uint8Array([9, 9, 9, 9])]]))
    expect(result.valid).toBe(false)
    expect(result.mismatchedDataGroups).toEqual([1])
  })

  it('builds EF.CardSecurity as an unwrapped ContentInfo', async () => {
    const ca = await createTestCa()
    const dsc = await createTestDsc(ca)
    const securityObject = new Uint8Array([0x31, 0x00])
    const cardSecurity = await buildCardSecurity(securityObject, dsc.der, dsc.key.privateKey)
    expect(cardSecurity[0]).toBe(0x30)
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cardSecurity))
    expect(contentInfo.contentType).toBe(CMS_OIDS.signedData)
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })
    expect(signedData.encapContentInfo.eContentType).toBe(CMS_OIDS.securityObject)
  })
})

describe('CSCA Master List', () => {
  it('includes the signer and CSCA certificates and verifies', async () => {
    const ca = await createTestCa()
    const mlKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const mlSigner = await createMasterListSigner(
      {
        commonName: 'ePass 42 Master List Signer',
        ...TEST_DATES,
        crlDistributionPoints: TEST_CRL_DP,
        pss: false,
      },
      mlKey,
      { certificate: ca.certificate, key: ca.key },
    )
    const masterList = await buildMasterList({
      cscaCertificates: [ca.der],
      signerCertificate: mlSigner.der,
      signerPrivateKey: mlKey.privateKey,
    })
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(masterList))
    expect(contentInfo.contentType).toBe(CMS_OIDS.signedData)
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })
    expect(signedData.encapContentInfo.eContentType).toBe(CMS_OIDS.cscaMasterList)
    const ok = await signedData.verify({ signer: 0, data: masterListEcontent(masterList) })
    expect(ok).toBe(true)
  })

  it('keeps the content a DER SET of certificates', () => {
    const content = masterListContent([new Uint8Array([1])], new Uint8Array([2]))
    expect(content[0]).toBe(0x30)
  })
})

function masterListEcontent(masterList: Uint8Array): ArrayBuffer {
  const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(masterList))
  const signedData = new pkijs.SignedData({ schema: contentInfo.content })
  const eContent = signedData.encapContentInfo.eContent!
  return toArrayBuffer(new Uint8Array(eContent.valueBlock.valueHexView))
}
