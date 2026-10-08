/**
 * Key material and hashing for the PKI package.
 *
 * Hashing, P-256 arithmetic and hex handling come from `@noble/hashes` and
 * `@noble/curves`; PKCS#8 key parsing comes from `pkijs`.  WebCrypto is used for
 * RSA key generation/signing and for importing keys into `@peculiar/x509`.
 */
import { p256 } from '@noble/curves/nist.js'
import { sha1 as nobleSha1 } from '@noble/hashes/legacy.js'
import {
  sha224 as nobleSha224,
  sha256 as nobleSha256,
  sha384 as nobleSha384,
  sha512 as nobleSha512,
} from '@noble/hashes/sha2.js'
import * as pkijs from 'pkijs'

import { concat, toArrayBuffer, trimLeadingZeros, type Bytes } from '../codec/bytes'
import { ecP256Spki, rsaSpki } from '../codec/der'

/** Supported hash algorithm names. */
export type HashName = 'SHA-1' | 'SHA-224' | 'SHA-256' | 'SHA-384' | 'SHA-512'

/** Hashes bytes with the requested algorithm. */
export function hash(name: HashName, data: Bytes): Bytes {
  switch (name) {
    case 'SHA-1':
      return nobleSha1(data)
    case 'SHA-224':
      return nobleSha224(data)
    case 'SHA-256':
      return nobleSha256(data)
    case 'SHA-384':
      return nobleSha384(data)
    case 'SHA-512':
      return nobleSha512(data)
  }
}

/** SHA-1 digest. */
export function sha1(data: Bytes): Bytes {
  return nobleSha1(data)
}

/** SHA-256 digest. */
export function sha256(data: Bytes): Bytes {
  return nobleSha256(data)
}

/** Cryptographically strong random bytes. */
export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

/** Generates a random positive serial with at least 64 significant bits. */
export function randomSerial(lengthBytes = 16): Bytes {
  if (lengthBytes < 8) throw new Error('serial must be at least 8 bytes')
  const bytes = randomBytes(lengthBytes)
  // Clear the leading bit so the two's-complement integer stays positive.
  bytes[0] &= 0x7f
  // Ensure the top byte is non-zero (at least 64 significant bits remain).
  if (bytes[0] === 0) bytes[0] = 0x01
  return bytes
}

/* ------------------------------------------------------------------ *
 * RSA
 * ------------------------------------------------------------------ */

/** Options for RSA key generation. */
export interface RsaKeyOptions {
  modulusLength?: number
  /** When true generate an RSA-PSS key; otherwise a PKCS#1 v1.5 key. */
  pss?: boolean
  hash?: HashName
}

/** An RSA key pair with its WebCrypto handles and encodings. */
export interface RsaKeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
  /** DER SubjectPublicKeyInfo. */
  spki: Bytes
  /** DER PKCS#8 private key. */
  pkcs8: Bytes
  modulus: Bytes
  publicExponent: Bytes
  privateExponent: Bytes
  modulusLength: number
  pss: boolean
}

/** Generates a fresh RSA key pair for CSCA/DSC signing. */
export async function generateRsaKeyPair(options: RsaKeyOptions = {}): Promise<RsaKeyPair> {
  const modulusLength = options.modulusLength ?? 2048
  const pss = options.pss ?? true
  const hash = options.hash ?? 'SHA-256'
  const algorithm = pss
    ? { name: 'RSA-PSS', modulusLength, publicExponent: new Uint8Array([0x01, 0x00, 0x01]), hash }
    : {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash,
      }
  const keyPair = (await crypto.subtle.generateKey(algorithm, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  return describeRsaKeyPair(keyPair, modulusLength, pss)
}

/** Imports a PKCS#8 RSA key pair, deriving the public key. */
export async function importRsaKeyPair(
  pkcs8: Bytes,
  pss = true,
  hash: HashName = 'SHA-256',
): Promise<RsaKeyPair> {
  const parsed = parseRsaPkcs8(pkcs8)
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(pkcs8),
    pss ? { name: 'RSA-PSS', hash } : { name: 'RSASSA-PKCS1-v1_5', hash },
    true,
    ['sign'],
  )
  const publicKey = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(rsaSpkiFromPrivateKey(parsed)),
    pss ? { name: 'RSA-PSS', hash } : { name: 'RSASSA-PKCS1-v1_5', hash },
    true,
    ['verify'],
  )
  return describeParsedRsaKeyPair(privateKey, publicKey, parsed, pss)
}

/** Extracts an RSA private key pair from a PKCS#8 private key handle. */
function parseRsaPkcs8(pkcs8: Bytes): pkijs.RSAPrivateKey {
  const info = pkijs.PrivateKeyInfo.fromBER(toArrayBuffer(pkcs8))
  const parsed = info.parsedKey
  if (!parsed || !(parsed instanceof pkijs.RSAPrivateKey)) {
    throw new Error('not an RSA PKCS#8 private key')
  }
  return parsed
}

function rsaSpkiFromPrivateKey(parsed: pkijs.RSAPrivateKey): Bytes {
  return rsaSpki(
    trimLeadingZeros(new Uint8Array(parsed.modulus.valueBlock.valueHexView)),
    trimLeadingZeros(new Uint8Array(parsed.publicExponent.valueBlock.valueHexView)),
  )
}

async function describeRsaKeyPair(
  keyPair: CryptoKeyPair,
  modulusLength: number,
  pss: boolean,
): Promise<RsaKeyPair> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  const parsed = parseRsaPkcs8(pkcs8)
  return describeParsedRsaKeyPair(keyPair.privateKey, keyPair.publicKey, parsed, pss, {
    spki,
    pkcs8,
    modulusLength,
  })
}

function describeParsedRsaKeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  parsed: pkijs.RSAPrivateKey,
  pss: boolean,
  encoded?: { spki: Bytes; pkcs8: Bytes; modulusLength: number },
): RsaKeyPair {
  const modulus = trimLeadingZeros(new Uint8Array(parsed.modulus.valueBlock.valueHexView))
  const publicExponent = trimLeadingZeros(
    new Uint8Array(parsed.publicExponent.valueBlock.valueHexView),
  )
  const privateExponent = trimLeadingZeros(
    new Uint8Array(parsed.privateExponent.valueBlock.valueHexView),
  )
  return {
    publicKey,
    privateKey,
    spki: encoded?.spki ?? rsaSpki(modulus, publicExponent),
    pkcs8: encoded?.pkcs8 ?? new Uint8Array(parsed.toSchema().toBER(false)),
    modulus,
    publicExponent,
    privateExponent,
    modulusLength: encoded?.modulusLength ?? modulus.length * 8,
    pss,
  }
}

/** Builds the DGI FF02 value: modLen || modulus || privateExpLen || privateExponent. */
export function aaPrivateKeyValue(modulus: Bytes, privateExponent: Bytes): Bytes {
  return concat(
    new Uint8Array([(modulus.length >> 8) & 0xff, modulus.length & 0xff]),
    modulus,
    new Uint8Array([(privateExponent.length >> 8) & 0xff, privateExponent.length & 0xff]),
    privateExponent,
  )
}

/* ------------------------------------------------------------------ *
 * P-256 / Chip Authentication
 * ------------------------------------------------------------------ */

/** A P-256 key pair with its private scalar and SubjectPublicKeyInfo. */
export interface P256KeyPair {
  scalar: Bytes
  spki: Bytes
}

/** Generates a fresh P-256 key pair for Chip Authentication. */
export function generateP256KeyPair(): P256KeyPair {
  const scalar = p256.utils.randomSecretKey()
  const point = p256.getPublicKey(scalar, false)
  return { scalar, spki: ecP256Spki(point) }
}
