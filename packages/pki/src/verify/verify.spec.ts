import { describe, expect, it } from 'vitest'

import { validateCertProfile, verifyDscAgainstCsca } from './verify'
import { createTestCa, createTestDsc } from '../testing'

describe('certificate profile validation', () => {
  it('accepts a conforming CSCA', async () => {
    const ca = await createTestCa()
    expect(validateCertProfile(ca.certificate, 'csca')).toEqual({ valid: true, errors: [] })
  })

  it('accepts a conforming DSC', async () => {
    const ca = await createTestCa()
    const dsc = await createTestDsc(ca)
    expect(validateCertProfile(dsc.certificate, 'dsc')).toEqual({ valid: true, errors: [] })
  })

  it('flags a CA certificate used as a DSC (BasicConstraints + missing DocumentType)', async () => {
    const ca = await createTestCa()
    const result = validateCertProfile(ca.certificate, 'dsc')
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('BasicConstraints')
    expect(result.errors.join(' ')).toContain('DocumentType')
  })
})

describe('DSC chain verification', () => {
  it('verifies a DSC against the issuing CSCA', async () => {
    const ca = await createTestCa()
    const dsc = await createTestDsc(ca)
    const result = await verifyDscAgainstCsca(dsc.certificate, [ca.certificate])
    expect(result.valid).toBe(true)
    expect(result.csca?.subject).toContain('CSCA')
  })

  it('rejects a DSC when the CSCA is not supplied', async () => {
    const ca = await createTestCa()
    const other = await createTestCa('Unrelated CSCA')
    const dsc = await createTestDsc(ca)
    const result = await verifyDscAgainstCsca(dsc.certificate, [other.certificate])
    expect(result.valid).toBe(false)
  })
})
