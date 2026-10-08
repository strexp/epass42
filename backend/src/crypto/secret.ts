/**
 * Secret and token helpers: hashing, random tokens and AES-256-GCM envelope
 * encryption for secrets stored at rest (M13 groundwork).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** A URL-safe random token of `bytes` entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Hashes a session/reference/token value before it is persisted. */
export function hashToken(token: string): string {
  return sha256Hex(token)
}

/** Decodes a base64 key and validates its length. */
export function decodeKey(base64: string, length = 32): Buffer {
  const key = Buffer.from(base64, 'base64')
  if (key.length !== length) {
    throw new Error(`expected a ${length}-byte key, got ${key.length}`)
  }
  return key
}

/** Encrypts UTF-8 plaintext with AES-256-GCM, returning `iv.tag.ciphertext` (base64). */
export function encryptSecret(plaintext: string, kek: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', kek, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Decrypts a value produced by {@link encryptSecret}. */
export function decryptSecret(encoded: string, kek: Buffer): string {
  const [ivPart, tagPart, dataPart] = encoded.split('.')
  if (!ivPart || !tagPart || !dataPart) throw new Error('malformed encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
