/**
 * Private-key sealing (M5, M13): CSCA/NIA DSC keys are stored as AES-256-GCM
 * envelope-encrypted PKCS#8.  The KEK comes from `encryptionKek`, else a random
 * key persisted at `<dataDir>/kek` (0600) so it survives restarts.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppConfig } from '../config'
import { decodeKey, decryptSecret, encryptSecret } from './secret'

/** Prefix marking a value sealed by {@link sealPrivateKey}. */
const SEAL_PREFIX = 'enc:v1:'

/** Reads the persisted KEK, generating it on first use. */
function loadOrCreateKekFile(dataDir: string): Buffer {
  const path = join(dataDir, 'kek')
  if (existsSync(path)) {
    const contents = readFileSync(path, 'utf8').trim()
    const key = Buffer.from(contents, 'base64')
    if (key.length !== 32) throw new Error(`invalid KEK file at ${path}`)
    return key
  }
  mkdirSync(dataDir, { recursive: true })
  const key = randomBytes(32)
  writeFileSync(path, `${key.toString('base64')}\n`, { mode: 0o600 })
  return key
}

/** Resolves the KEK used to seal and open private keys. */
export function resolveKeks(config: AppConfig, dataDir: string): Buffer[] {
  if (config.encryptionKek) return [decodeKey(config.encryptionKek, 32)]
  return [loadOrCreateKekFile(dataDir)]
}

/** Seals PKCS#8 key bytes into an opaque `key_ref` string. */
export function sealPrivateKey(pkcs8: Uint8Array, kek: Buffer): string {
  const encoded = Buffer.from(pkcs8).toString('base64')
  return SEAL_PREFIX + encryptSecret(encoded, kek)
}

/** Opens a `key_ref` back into PKCS#8 key bytes, trying each KEK in turn. */
export function openPrivateKey(keyRef: string, keks: Buffer | Buffer[]): Uint8Array {
  if (!keyRef.startsWith(SEAL_PREFIX)) throw new Error('key_ref is not a sealed private key')
  const payload = keyRef.slice(SEAL_PREFIX.length)
  const candidates = Array.isArray(keks) ? keks : [keks]
  let lastError: unknown
  for (const kek of candidates) {
    try {
      const base64 = decryptSecret(payload, kek)
      return new Uint8Array(Buffer.from(base64, 'base64'))
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `unable to decrypt sealed private key (KEK mismatch); ${(lastError as Error)?.message ?? ''}`.trim(),
  )
}
