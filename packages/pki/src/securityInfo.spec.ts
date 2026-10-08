import { describe, expect, it } from 'vitest'

import { derOid, parseTlv } from './der'
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
})
