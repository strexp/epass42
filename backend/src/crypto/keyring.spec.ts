import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseConfig } from '../config'
import { openPrivateKey, resolveKeks, sealPrivateKey } from './keyring'

function configWithSecret(secret: string) {
  return parseConfig({ env: 'test', sessionSecret: secret })
}

describe('private key sealing', () => {
  it('opens a sealed key with any of the candidate KEKs', () => {
    const a = randomBytes(32)
    const b = randomBytes(32)
    const ref = sealPrivateKey(new Uint8Array([1, 2, 3, 4]), a)
    expect(Array.from(openPrivateKey(ref, [b, a]))).toEqual([1, 2, 3, 4])
    expect(() => openPrivateKey(ref, [b])).toThrow(/KEK mismatch/)
  })

  it('persists a stable primary KEK across config changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkd42-kek-'))
    const first = resolveKeks(configWithSecret('secret-one-0123456789'), dir)
    const second = resolveKeks(configWithSecret('secret-two-0123456789'), dir)
    // The primary (used for sealing) does not depend on the session secret.
    expect(first[0]!.equals(second[0]!)).toBe(true)
    // A key sealed with the first primary opens with the second config's KEKs.
    const ref = sealPrivateKey(new Uint8Array([9, 9]), first[0]!)
    expect(Array.from(openPrivateKey(ref, second))).toEqual([9, 9])
  })

  it('uses the configured ENCRYPTION_KEK when present', () => {
    const kek = randomBytes(32).toString('base64')
    const config = parseConfig({
      env: 'test',
      sessionSecret: 'x'.repeat(20),
      encryptionKek: kek,
    })
    const keks = resolveKeks(config, '/tmp/does-not-matter')
    expect(keks).toHaveLength(1)
    expect(keks[0]!.equals(Buffer.from(kek, 'base64'))).toBe(true)
  })
})
