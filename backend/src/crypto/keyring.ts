/**
 * Private-key sealing (M5, M13 groundwork).
 *
 * The online CSCA and NIA DSC private keys are stored as AES-256-GCM
 * envelope-encrypted PKCS#8 rather than clear PEM.
 *
 * The KEK comes from `ENCRYPTION_KEK`.  When that is not configured a random
 * key is generated once and persisted in `<dataDir>/kek` (0600) so that the
 * same key survives restarts even if the session secret changes.  The legacy
 * derivation from the session secret is kept as a fallback so keys sealed by an
 * earlier version can still be opened.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppConfig } from '../config'
import { DEV_SESSION_SECRET } from '../config'
import { decodeKey, decryptSecret, encryptSecret } from './secret'

/** Prefix marking a value sealed by {@link sealPrivateKey}. */
const SEAL_PREFIX = 'enc:v1:'

/** Reads the persisted development KEK, generating it on first use. */
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

/** The legacy KEK derived from a session secret. */
function sessionKek(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

/**
 * Resolves the ordered list of KEKs to try.  The first is used for sealing new
 * keys; the rest are only attempted when opening existing keys.
 */
export function resolveKeks(config: AppConfig, dataDir: string): Buffer[] {
  if (config.encryptionKek) return [decodeKey(config.encryptionKek, 32)]
  return [
    loadOrCreateKekFile(dataDir),
    sessionKek(config.sessionSecret),
    // Recovery for development databases bootstrapped before a custom session
    // secret was configured.
    sessionKek(DEV_SESSION_SECRET),
  ]
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

/** True when a value looks like a sealed key reference. */
export function isSealed(ref: string): boolean {
  return ref.startsWith(SEAL_PREFIX)
}
