/**
 * Private-key sealing (M5, M13 groundwork).
 *
 * The online CSCA and NIA DSC private keys are stored as AES-256-GCM
 * envelope-encrypted PKCS#8 rather than clear PEM.  The KEK comes from
 * `ENCRYPTION_KEK`; in development it is derived from the session secret.
 */
import { createHash } from 'node:crypto'

import type { AppConfig } from '../config'
import { decodeKey, decryptSecret, encryptSecret } from './secret'

/** Prefix marking a value sealed by {@link sealPrivateKey}. */
const SEAL_PREFIX = 'enc:v1:'

/** Resolves the 32-byte KEK from configuration. */
export function resolveKek(config: AppConfig): Buffer {
  if (config.encryptionKek) return decodeKey(config.encryptionKek, 32)
  // Development fallback: derive a stable key from the session secret.
  return createHash('sha256').update(config.sessionSecret, 'utf8').digest()
}

/** Seals PKCS#8 key bytes into an opaque `key_ref` string. */
export function sealPrivateKey(pkcs8: Uint8Array, kek: Buffer): string {
  const encoded = Buffer.from(pkcs8).toString('base64')
  return SEAL_PREFIX + encryptSecret(encoded, kek)
}

/** Opens a `key_ref` back into PKCS#8 key bytes. */
export function openPrivateKey(keyRef: string, kek: Buffer): Uint8Array {
  if (!keyRef.startsWith(SEAL_PREFIX)) throw new Error('key_ref is not a sealed private key')
  const base64 = decryptSecret(keyRef.slice(SEAL_PREFIX.length), kek)
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/** True when a value looks like a sealed key reference. */
export function isSealed(ref: string): boolean {
  return ref.startsWith(SEAL_PREFIX)
}
