import { describe, expect, it } from 'vitest'

import { expiryDescription, type LifecycleCertificate } from './useLifecycleStatus'

const BASE: LifecycleCertificate = {
  id: 1,
  notAfter: '2036-01-01T00:00:00.000Z',
  expired: true,
  daysRemaining: -1,
}

const formatDate = (value: string | null | undefined): string => value ?? '—'

const messages = {
  missing: 'missing',
  certificate: (date: string) => `certificate ${date}`,
  privateKey: (date: string) => `private key ${date}`,
}

describe('expiryDescription', () => {
  it('reports a missing certificate', () => {
    expect(expiryDescription(null, messages, formatDate)).toBe('missing')
  })

  it('reports the issuer when the parent certificate expired', () => {
    const signer: LifecycleCertificate = {
      ...BASE,
      parentNotAfter: '2029-01-01T00:00:00.000Z',
      parentExpired: true,
    }
    expect(
      expiryDescription(
        signer,
        { ...messages, parent: (date: string) => `issuer ${date}` },
        formatDate,
      ),
    ).toBe('issuer 2029-01-01T00:00:00.000Z')
  })

  it('quotes the private-key date when that period ended first', () => {
    const signer: LifecycleCertificate = {
      ...BASE,
      privateKeyNotAfter: '2026-04-01T00:00:00.000Z',
      privateKeyExpired: true,
    }
    expect(expiryDescription(signer, messages, formatDate)).toBe(
      'private key 2026-04-01T00:00:00.000Z',
    )
  })

  it('quotes the effective certificate date for an expired certificate', () => {
    const signer: LifecycleCertificate = {
      ...BASE,
      privateKeyNotAfter: '2035-01-01T00:00:00.000Z',
      privateKeyExpired: false,
      effectiveNotAfter: '2030-01-01T00:00:00.000Z',
    }
    expect(expiryDescription(signer, messages, formatDate)).toBe(
      'certificate 2030-01-01T00:00:00.000Z',
    )
  })

  it('falls back to notAfter when the API did not send an effective date', () => {
    expect(expiryDescription(BASE, messages, formatDate)).toBe(
      'certificate 2036-01-01T00:00:00.000Z',
    )
  })
})
