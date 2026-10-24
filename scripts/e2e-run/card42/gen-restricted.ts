/**
 * Issues a second, restricted CVCA -> DV -> IS chain from the same CVCA key so
 * the negative Terminal Authentication paths can be exercised without touching
 * the card's personalized trust point.
 */
import { createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createCvCertificate,
  cvPublicKeyOf,
  generateEcKeyPair,
  importEcKeyPair,
  parseCvCertificate,
  pemToDer,
  type EcKeyPair,
} from '@epass42/pki'
import type { DvPermissions } from '@epass42/shared'

const OUT = join(import.meta.dirname, 'out')

/** P-256 private scalar from a PKCS#8 key. */
function scalarOf(key: EcKeyPair): string {
  const jwk = createPrivateKey({
    key: Buffer.from(key.pkcs8),
    format: 'der',
    type: 'pkcs8',
  }).export({ format: 'jwk' }) as { d?: string }
  if (!jwk.d) throw new Error('no EC scalar')
  const raw = Buffer.from(jwk.d, 'base64url')
  return Buffer.concat([Buffer.alloc(32 - raw.length), raw]).toString('hex')
}

const EPASSPORT_ONLY: DvPermissions = {
  epassport: { dg3: true, dg4: true },
  travel: { read: false, write: false },
  visa: { read: false, write: false },
  biometrics: { read: false, write: false },
}

const TRAVEL_READ: DvPermissions = {
  epassport: { dg3: true, dg4: true },
  travel: { read: true, write: false },
  visa: { read: false, write: false },
  biometrics: { read: false, write: false },
}

async function main(): Promise<void> {
  const cvcaCert = parseCvCertificate(new Uint8Array(readFileSync(join(OUT, 'cvca.cvc'))))
  if (cvcaCert.publicKey.algorithm !== 'ec') throw new Error('CVCA is not EC')
  const cvcaKey = await importEcKeyPair(
    pemToDer(readFileSync(join(OUT, 'cvca-key.pem'), 'utf8')),
    cvcaCert.publicKey.point,
  )
  const dvKey = await generateEcKeyPair('P-256')
  const isKey = await generateEcKeyPair('P-256')
  const dv = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'DVR',
      sequence: '1',
      role: 'dv',
      dvClass: 'domestic',
      permissions: TRAVEL_READ,
      notBefore: cvcaCert.effectiveDate,
      notAfter: cvcaCert.expirationDate,
      publicKey: cvPublicKeyOf(dvKey),
    },
    { authorityReference: cvcaCert.holderReference, key: cvcaKey },
  )
  const is = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'ISR',
      sequence: '1',
      role: 'terminal',
      permissions: TRAVEL_READ,
      notBefore: cvcaCert.effectiveDate,
      notAfter: cvcaCert.expirationDate,
      publicKey: cvPublicKeyOf(isKey),
    },
    { authorityReference: dv.holderReference, key: dvKey },
  )
  writeFileSync(join(OUT, 'ta-chain-restricted.der'), new Uint8Array([...dv.der, ...is.der]))
  writeFileSync(join(OUT, 'ta-key-restricted.txt'), scalarOf(isKey) + '\n')
  writeFileSync(join(OUT, 'dv-restricted.cvc'), dv.der)
  writeFileSync(join(OUT, 'is-restricted.cvc'), is.der)

  // A chain that grants nothing LDS2 (ePassport CHAT only): no 65/73 extension.
  const dvKey2 = await generateEcKeyPair('P-256')
  const isKey2 = await generateEcKeyPair('P-256')
  const dv2 = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'DVE',
      sequence: '1',
      role: 'dv',
      dvClass: 'domestic',
      permissions: EPASSPORT_ONLY,
      notBefore: cvcaCert.effectiveDate,
      notAfter: cvcaCert.expirationDate,
      publicKey: cvPublicKeyOf(dvKey2),
    },
    { authorityReference: cvcaCert.holderReference, key: cvcaKey },
  )
  const is2 = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'ISE',
      sequence: '1',
      role: 'terminal',
      permissions: EPASSPORT_ONLY,
      notBefore: cvcaCert.effectiveDate,
      notAfter: cvcaCert.expirationDate,
      publicKey: cvPublicKeyOf(isKey2),
    },
    { authorityReference: dv2.holderReference, key: dvKey2 },
  )
  writeFileSync(join(OUT, 'ta-chain-epassport.der'), new Uint8Array([...dv2.der, ...is2.der]))
  writeFileSync(join(OUT, 'ta-key-epassport.txt'), scalarOf(isKey2) + '\n')
  console.log(
    JSON.stringify(
      {
        dv: dv.holderReference,
        is: is.holderReference,
        permissions: TRAVEL_READ,
        chainBytes: dv.der.length + is.der.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
