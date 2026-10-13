import { describe, expect, it } from 'vitest'

import { derOid, parseTlv } from '../codec/der'
import { buildCardAccess, buildSecurityObject, SECURITY_INFO_OIDS } from './securityInfo'

describe('SecurityInfo', () => {
  it('builds EF.CardAccess as a DER SET with the selected mechanisms', () => {
    const cardAccess = buildCardAccess({
      paceEcdhGm3des: true,
      paceEcdhGmAes128: false,
      caEcdh3des: true,
      caEcdhAes128: false,
      caKeyId: 1,
      aa: false,
    })
    const root = parseTlv(cardAccess)
    expect(root.tag).toBe(0x31)
    expect(root.children).toHaveLength(2)
  })

  it('requires at least one mechanism', () => {
    expect(() =>
      buildCardAccess({
        paceEcdhGm3des: false,
        paceEcdhGmAes128: false,
        caEcdh3des: false,
        caEcdhAes128: false,
        caKeyId: 1,
        aa: false,
      }),
    ).toThrow()
  })

  it('advertises the card42 AA signature algorithm (SHA-1)', () => {
    const cardAccess = buildCardAccess({
      paceEcdhGm3des: false,
      paceEcdhGmAes128: false,
      caEcdh3des: false,
      caEcdhAes128: false,
      caKeyId: 1,
      aa: true,
    })
    const root = parseTlv(cardAccess)
    expect(root.children).toHaveLength(1)
    // ActiveAuthenticationInfo SEQUENCE { id-AA, version 1, SHA-1 with RSA }.
    const [oid, version, signatureAlg] = root.children[0].children
    expect(oid.value).toEqual(derOid(SECURITY_INFO_OIDS.idAa).slice(2))
    expect(version.value).toEqual(new Uint8Array([1]))
    expect(signatureAlg.value).toEqual(derOid('1.2.840.113549.1.1.5').slice(2))
  })

  it('adds the CA public key to the SecurityObject', () => {
    const cardAccess = buildCardAccess({
      paceEcdhGm3des: true,
      paceEcdhGmAes128: false,
      caEcdh3des: true,
      caEcdhAes128: false,
      caKeyId: 1,
      aa: false,
    })
    const securityObject = buildSecurityObject(cardAccess, new Uint8Array([4, 1, 2, 3]), 1)
    const root = parseTlv(securityObject)
    expect(root.tag).toBe(0x31)
    expect(root.children).toHaveLength(3)
    // The added entry carries the id-PK-ECDH OID.
    const oid = root.children[2].children[0]
    expect(oid.tag).toBe(0x06)
    expect(oid.value).toEqual(derOid(SECURITY_INFO_OIDS.idPkEcdh).slice(2))
  })

  it('advertises Chip Authentication version 1 and Terminal Authentication', () => {
    const cardAccess = buildCardAccess({
      paceEcdhGm3des: true,
      paceEcdhGmAes128: false,
      caEcdh3des: true,
      caEcdhAes128: true,
      caKeyId: 1,
      aa: false,
      ta: true,
    })
    const root = parseTlv(cardAccess)
    expect(root.children).toHaveLength(4)
    // ChipAuthenticationInfo version is 1 (Doc 9303-11 §9.2.5) for both profiles.
    expect(root.children[1].children[1].value).toEqual(new Uint8Array([1]))
    expect(root.children[2].children[1].value).toEqual(new Uint8Array([1]))
    // The AES-128 CA OID is advertised.
    expect(root.children[2].children[0].value).toEqual(
      derOid(SECURITY_INFO_OIDS.caEcdhAes128).slice(2),
    )
    // TerminalAuthenticationInfo SEQUENCE { id-TA, version 1 }.
    const ta = root.children[3].children
    expect(ta[0].value).toEqual(derOid('0.4.0.127.0.7.2.2.2').slice(2))
    expect(ta[1].value).toEqual(new Uint8Array([1]))
  })

  it('advertises the ECDSA ActiveAuthenticationInfo OID', () => {
    const cardAccess = buildCardAccess({
      paceEcdhGm3des: false,
      paceEcdhGmAes128: false,
      caEcdh3des: false,
      caEcdhAes128: false,
      caKeyId: 1,
      aa: true,
      aaSignatureAlgOid: '0.4.0.127.0.7.1.1.4.1.3',
    })
    const root = parseTlv(cardAccess)
    const [oid, version, signatureAlg] = root.children[0].children
    expect(oid.value).toEqual(derOid(SECURITY_INFO_OIDS.idAa).slice(2))
    expect(version.value).toEqual(new Uint8Array([1]))
    expect(signatureAlg.value).toEqual(derOid('0.4.0.127.0.7.1.1.4.1.3').slice(2))
  })
})
