import { describe, expect, it } from 'vitest'

import { emptyPermissions, type DvPermissions } from '@epass42/shared'
import { generateEcKeyPair, generateRsaKeyPair } from '../crypto/crypto'
import {
  certificateReference,
  createCvCertificate,
  createCvcaRoot,
  cvPublicKey,
  isCvCertificate,
  parseCvCertificate,
  verifyCvCertificate,
} from './cvc'

const PERMISSIONS: DvPermissions = {
  epassport: { dg3: true, dg4: false },
  travel: { read: true, write: false },
  visa: { read: true, write: true },
  biometrics: { read: false, write: false },
}

const DATES = {
  notBefore: new Date('2026-05-01T00:00:00Z'),
  notAfter: new Date('2026-08-01T00:00:00Z'),
}

describe('card-verifiable certificates', () => {
  it('builds and verifies a self-signed EC CVCA root', async () => {
    const key = await generateEcKeyPair()
    const cvca = await createCvcaRoot(
      {
        country: 'XD',
        holderMnemonic: 'CVCA',
        sequence: 'XD001',
        role: 'cvca',
        permissions: emptyPermissions(),
        ...DATES,
      },
      key,
    )

    expect(isCvCertificate(cvca.der)).toBe(true)
    const parsed = parseCvCertificate(cvca.der)
    expect(parsed.role).toBe('cvca')
    expect(parsed.publicKey.algorithm).toBe('ec')
    expect(parsed.holderReference).toBe(certificateReference('XD', 'CVCA', 'XD001'))
    expect(parsed.authorityReference).toBe(parsed.holderReference)
    expect(parsed.effectiveDate.toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(parsed.expirationDate.toISOString()).toBe('2026-08-01T00:00:00.000Z')

    expect(await verifyCvCertificate(parsed, await cvPublicKey(parsed))).toBe(true)
  })

  it('issues an EC DV certificate that chains to the CVCA and carries permissions', async () => {
    const cvcaKey = await generateEcKeyPair()
    const cvca = await createCvcaRoot(
      {
        country: 'XD',
        holderMnemonic: 'CVCA',
        sequence: 'XD001',
        role: 'cvca',
        permissions: PERMISSIONS,
        ...DATES,
      },
      cvcaKey,
    )
    const cvcaParsed = parseCvCertificate(cvca.der)

    const dvKey = await generateEcKeyPair()
    const dv = await createCvCertificate(
      {
        country: 'XD',
        holderMnemonic: 'EXAMPLEDV',
        sequence: 'XD002',
        role: 'dv',
        dvClass: 'foreign',
        permissions: PERMISSIONS,
        ...DATES,
        publicKey: { algorithm: 'ec', point: dvKey.point },
      },
      { authorityReference: cvcaParsed.holderReference, key: cvcaKey },
    )

    const parsed = parseCvCertificate(dv.der)
    expect(parsed.role).toBe('dv')
    expect(parsed.dvClass).toBe('foreign')
    expect(parsed.permissions).toEqual(PERMISSIONS)
    expect(parsed.authorityReference).toBe(cvcaParsed.holderReference)

    expect(await verifyCvCertificate(parsed, await cvPublicKey(cvcaParsed))).toBe(true)

    // A tampered body no longer verifies.
    const tampered = { ...parsed, body: new Uint8Array([...parsed.body, 0x00]) }
    expect(await verifyCvCertificate(tampered, await cvPublicKey(cvcaParsed))).toBe(false)
  })

  it('supports the RSA-PSS profile for the certified public key', async () => {
    const cvcaKey = await generateEcKeyPair()
    const cvca = await createCvcaRoot(
      {
        country: 'XD',
        holderMnemonic: 'CVCA',
        sequence: 'XD001',
        role: 'cvca',
        permissions: emptyPermissions(),
        ...DATES,
      },
      cvcaKey,
    )
    const dvKey = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
    const dv = await createCvCertificate(
      {
        country: 'XD',
        holderMnemonic: 'RSADV',
        sequence: 'XD003',
        role: 'dv',
        permissions: PERMISSIONS,
        ...DATES,
        publicKey: {
          algorithm: 'rsa',
          modulus: dvKey.modulus,
          publicExponent: dvKey.publicExponent,
        },
      },
      { authorityReference: parseCvCertificate(cvca.der).holderReference, key: cvcaKey },
    )
    const parsed = parseCvCertificate(dv.der)
    expect(parsed.publicKey.algorithm).toBe('rsa')
    expect(await verifyCvCertificate(parsed, await cvPublicKey(parseCvCertificate(cvca.der)))).toBe(
      true,
    )
  })
})
