/**
 * Key material fixtures for the backend suite.
 *
 * The backend accepts a CSR or a bare SubjectPublicKeyInfo PEM for
 * `user_uploaded` applications.  These helpers generate real keys with
 * WebCrypto so the issued certificate can be compared with the submitted key.
 * `ecPrivateKeyScalar()` converts an exported PKCS#8 key into the raw scalar
 * card42 expects for Terminal Authentication.
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'

import {
  ascii,
  derBitString,
  derInteger,
  derIntegerBytes,
  derOid,
  derSequence,
  derSet,
  derTlv,
  derToPem,
  generateEcKeyPair,
  generateRsaKeyPair,
  pemToDer,
  toArrayBuffer,
} from '@epass42/pki'

/** A freshly generated EC SubjectPublicKeyInfo PEM. */
export async function ecPublicKeyPem(curve: 'P-256' | 'P-384' = 'P-256'): Promise<string> {
  const key = await generateEcKeyPair(curve)
  return derToPem(key.spki, 'PUBLIC KEY')
}

/** A freshly generated RSA SubjectPublicKeyInfo PEM. */
export async function rsaPublicKeyPem(options: { pss?: boolean } = {}): Promise<string> {
  const key = await generateRsaKeyPair({ modulusLength: 2048, pss: options.pss ?? false })
  return derToPem(key.spki, 'PUBLIC KEY')
}

/** The DER body of a PEM block (certificate, key or SPKI). */
export function pemBody(pem: string): Uint8Array {
  return pemToDer(pem)
}

/**
 * The raw P-256 private scalar (32 bytes) of a PKCS#8 EC PEM, as the terminal
 * authentication key card42 expects.
 */
export function ecPrivateKeyScalar(pkcs8Pem: string): Uint8Array {
  const key = createPrivateKey({
    key: Buffer.from(pemToDer(pkcs8Pem)),
    format: 'der',
    type: 'pkcs8',
  })
  const jwk = key.export({ format: 'jwk' }) as { d?: string; crv?: string }
  if (!jwk.d || jwk.crv !== 'P-256') throw new Error('expected a P-256 private key')
  const raw = Buffer.from(jwk.d, 'base64url')
  const scalar = new Uint8Array(32)
  scalar.set(raw.subarray(Math.max(0, raw.length - 32)), 32 - Math.min(32, raw.length))
  return scalar
}

/** The SubjectPublicKeyInfo DER of a private-key PEM. */
export function publicKeyDerOfPrivateKey(pkcs8Pem: string): Uint8Array {
  const privateKey = createPrivateKey({
    key: Buffer.from(pemToDer(pkcs8Pem)),
    format: 'der',
    type: 'pkcs8',
  })
  return new Uint8Array(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }))
}

/**
 * Builds a real PKCS#10 CSR for an ECDSA key (the backend accepts either a CSR
 * or a bare SPKI for `user_uploaded` applications).  The CSR signature is
 * generated but not verified by the service, which only extracts the SPKI.
 */
export async function ecCsrPem(
  commonName = 'E2E CSR',
  curve: 'P-256' | 'P-384' = 'P-256',
): Promise<{ csrPem: string; publicKeyDer: Uint8Array }> {
  const key = await generateEcKeyPair(curve)
  const name = derSequence(derSet(derSequence(derOid('2.5.4.3'), derTlv(0x0c, ascii(commonName)))))
  const info = derSequence(derInteger(0), name, key.spki, derTlv(0xa0, new Uint8Array()))
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key.privateKey,
      toArrayBuffer(info),
    ),
  )
  const signatureDer = derSequence(
    derIntegerBytes(signature.slice(0, 32)),
    derIntegerBytes(signature.slice(32)),
  )
  const csr = derSequence(
    info,
    derSequence(derOid('1.2.840.10045.4.3.2')),
    derBitString(signatureDer),
  )
  return { csrPem: derToPem(csr, 'CERTIFICATE REQUEST'), publicKeyDer: key.spki }
}
