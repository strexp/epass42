import { describe, expect, it } from 'vitest'

import {
  emptyPermissions,
  encodeAuthorization,
  withLds2Access,
  type DvPermissions,
} from './schemas'

/** Formats an authorization as lowercase hex (`ePassport, travel, visa, bio`). */
function hex(permissions: DvPermissions): string {
  return Array.from(encodeAuthorization(permissions), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

describe('LDS2 authorization', () => {
  it('maps the ePassport and LDS2 bits onto the four relative-authorization bytes', () => {
    const epassportOnly: DvPermissions = {
      ...emptyPermissions(),
      epassport: { dg3: true, dg4: true },
    }
    expect(hex(epassportOnly)).toBe('03000000')

    const travelRead: DvPermissions = { ...epassportOnly, travel: { read: true, write: false } }
    expect(hex(travelRead)).toBe('03050000')

    const travelWrite: DvPermissions = { ...epassportOnly, travel: { read: false, write: true } }
    expect(hex(travelWrite)).toBe('030a0000')
  })

  it('opens read and append for only the emitted applications', () => {
    const base: DvPermissions = { ...emptyPermissions(), epassport: { dg3: true, dg4: true } }

    expect(hex(withLds2Access(base, ['travel']))).toBe('030f0000')
    expect(hex(withLds2Access(base, ['travel', 'visa']))).toBe('030f0f00')
    expect(hex(withLds2Access(base, ['travel', 'visa', 'biometrics']))).toBe('030f0f0f')
    // No emitted application leaves the authorization untouched.
    expect(withLds2Access(base, [])).toBe(base)
  })

  it('keeps the ePassport bits and does not mutate the base grant', () => {
    const base: DvPermissions = {
      epassport: { dg3: false, dg4: true },
      travel: { read: false, write: false },
      visa: { read: true, write: false },
      biometrics: { read: false, write: false },
    }
    const next = withLds2Access(base, ['travel'])

    expect(next.epassport).toEqual({ dg3: false, dg4: true })
    expect(next.visa).toEqual({ read: true, write: false })
    expect(next.travel).toEqual({ read: true, write: true })
    expect(next.biometrics).toEqual({ read: false, write: false })
    expect(base.travel).toEqual({ read: false, write: false })
  })
})
