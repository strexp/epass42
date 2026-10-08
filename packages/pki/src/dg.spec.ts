import { describe, expect, it } from 'vitest'

import { ascii, concat } from './bytes'
import {
  buildDg1,
  buildDg2,
  buildDg5,
  buildDg7,
  buildDg11,
  buildDg12,
  buildDg13Text,
  buildDg14,
  buildDg15,
  buildDg16,
  dgFid,
  dgTag,
  wrapDg3,
  wrapDg4,
} from './dg'
import { derInteger, derTlv, parseTlv, type TlvNode } from './der'
import type { MrzFields } from './mrz'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function find(node: TlvNode, tag: number): TlvNode | undefined {
  if (node.tag === tag) return node
  for (const child of node.children) {
    const found = find(child, tag)
    if (found) return found
  }
  return undefined
}

describe('data group tags', () => {
  it('maps data group numbers to tags and FIDs', () => {
    expect(dgTag(1)).toBe(0x61)
    expect(dgTag(15)).toBe(0x6f)
    expect(dgFid(1)).toBe(0x0101)
    expect(dgFid(16)).toBe(0x0110)
    expect(() => dgTag(17)).toThrow()
  })
})

describe('DG2', () => {
  it('builds the CBEFF/ISO 19794-5 structure', () => {
    const dg2 = buildDg2(JPEG, 45, 35)
    const root = parseTlv(dg2)
    expect(root.tag).toBe(0x75)
    expect(find(root, 0x7f61)).toBeTruthy()
    expect(find(root, 0x7f60)).toBeTruthy()
    expect(find(root, 0xa1)).toBeTruthy()
    expect(find(root, 0x5f2e)).toBeTruthy()

    const face = find(root, 0x5f2e)!
    const text = String.fromCharCode(...face.value.slice(0, 4))
    expect(text).toBe('FAC\0')
    // The whole record length field covers the record.
    const recordLength =
      (face.value[8] << 24) | (face.value[9] << 16) | (face.value[10] << 8) | face.value[11]
    expect(recordLength).toBe(face.value.length)
  })

  it('round-trips the sample dimensions in the header', () => {
    const dg2 = buildDg2(JPEG, 45, 35)
    const face = find(parseTlv(dg2), 0x5f2e)!
    // 4+4+4+2+4 prefix bytes, then the facial record: width at facial offset 18.
    const widthOffset = 18 + 18
    const heightOffset = widthOffset + 2
    expect((face.value[widthOffset] << 8) | face.value[widthOffset + 1]).toBe(45)
    expect((face.value[heightOffset] << 8) | face.value[heightOffset + 1]).toBe(35)
  })
})

describe('DG3 / DG4 wrapping', () => {
  const inner = derTlv(0x7f61, concat(derInteger(1), derTlv(0x7f60, derTlv(0x5f2e, ascii('BDB')))))

  it('wraps DG3 in the 63 outer tag', () => {
    const dg3 = wrapDg3(inner)
    expect(dg3[0]).toBe(0x63)
    expect(find(parseTlv(dg3), 0x5f2e)?.value).toEqual(ascii('BDB'))
  })

  it('wraps DG4 in the 76 outer tag', () => {
    expect(wrapDg4(inner)[0]).toBe(0x76)
  })

  it('rejects a count mismatch', () => {
    const bad = derTlv(0x7f61, concat(derInteger(2), derTlv(0x7f60, derTlv(0x5f2e, ascii('BDB')))))
    expect(() => wrapDg3(bad)).toThrow()
  })
})

describe('DG5 / DG7', () => {
  it('wraps display images', () => {
    const dg5 = parseTlv(buildDg5(JPEG))
    expect(dg5.tag).toBe(0x65)
    expect(find(dg5, 0x5f40)?.value).toEqual(JPEG)
    const dg7 = parseTlv(buildDg7(JPEG))
    expect(dg7.tag).toBe(0x67)
    expect(find(dg7, 0x5f43)?.value).toEqual(JPEG)
  })
})

describe('DG11', () => {
  it('builds a tag list and the structured fields', () => {
    const dg11 = buildDg11({
      fullName: 'ERIKSSON ANNA MARIA',
      otherNames: ['ANNA'],
      personalNumber: 'ZE184226B',
      fullDateOfBirth: '19690806',
      placeOfBirth: 'STOCKHOLM',
    })
    const root = parseTlv(dg11)
    expect(root.tag).toBe(0x6b)
    const tagList = find(root, 0x5c)!
    // 5F0E, 5F0F, 5F10, 5F2B, 5F11.
    expect(tagList.value).toHaveLength(10)
    expect(find(root, 0x5f0e)?.value).toEqual(ascii('ERIKSSON ANNA MARIA'))
    expect(find(root, 0x5f0f)?.value).toEqual(ascii('ANNA'))
    expect(find(root, 0x5f2b)?.value).toEqual(ascii('19690806'))
  })
})

describe('DG12', () => {
  it('builds the additional document details', () => {
    const dg12 = buildDg12({
      issuingAuthority: 'NIA',
      dateOfIssue: '20260101',
      personalizationTime: '20260101120000',
      personalizationDevice: 'PKD42-01',
    })
    const root = parseTlv(dg12)
    expect(root.tag).toBe(0x6c)
    expect(find(root, 0x5f19)?.value).toEqual(ascii('NIA'))
    expect(find(root, 0x5f55)?.value).toEqual(ascii('20260101120000'))
    expect(find(root, 0x5f56)?.value).toEqual(ascii('PKD42-01'))
  })
})

describe('DG13 / DG14 / DG15 / DG16', () => {
  it('wraps issuer-defined content', () => {
    const dg13 = parseTlv(buildDg13Text(ascii('free text')))
    expect(dg13.tag).toBe(0x6d)
    expect(find(dg13, 0x5f0e)?.value).toEqual(ascii('free text'))
  })

  it('wraps SecurityInfos for DG14', () => {
    const securityInfos = derTlv(0x31, new Uint8Array(0))
    expect(parseTlv(buildDg14(securityInfos)).tag).toBe(0x6e)
  })

  it('wraps a SubjectPublicKeyInfo for DG15', () => {
    const spki = derTlv(0x30, new Uint8Array([1, 2, 3]))
    expect(find(parseTlv(buildDg15(spki)), 0x30)?.value).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('builds DG16 person entries', () => {
    const dg16 = buildDg16([{ name: 'JANE DOE', telephone: '+1', dateRecorded: '20260101' }])
    const root = parseTlv(dg16)
    expect(root.tag).toBe(0x70)
    expect(root.children[0].tag).toBe(0x02)
    expect(find(root, 0x5f50)?.value).toEqual(ascii('JANE DOE'))
    expect(find(root, 0x5f53)?.value).toEqual(ascii('20260101'))
  })
})

describe('DG1', () => {
  it('wraps the MRZ', () => {
    const mrz: MrzFields = {
      documentCode: 'P',
      issuingState: 'UDN',
      surname: 'DOE',
      givenNames: 'JANE',
      documentNumber: 'X1234567',
      nationality: 'UDN',
      dateOfBirth: '900101',
      sex: 'F',
      dateOfExpiry: '300101',
      personalNumber: '',
      optionalData: '',
    }
    const root = parseTlv(buildDg1(mrz))
    expect(root.tag).toBe(0x61)
    expect(find(root, 0x5f1f)?.value).toHaveLength(88)
  })
})
