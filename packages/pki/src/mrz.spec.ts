import { describe, expect, it } from 'vitest'

import { bytesToHex } from './hex'
import {
  buildMrzLines,
  checkDigit,
  mrzBytes,
  mrzInformation,
  padMrz,
  validateMrzLines,
  type MrzFields,
} from './mrz'
import { buildDg1 } from './dg'

/** The ICAO Doc 9303-11 sample passport fields. */
const SAMPLE: MrzFields = {
  documentCode: 'P',
  issuingState: 'UTO',
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  documentNumber: 'L898902C',
  nationality: 'UTO',
  dateOfBirth: '690806',
  sex: 'F',
  dateOfExpiry: '940623',
  personalNumber: 'ZE184226B',
  optionalData: '',
}

const SAMPLE_LINE1 = 'P<UTOERIKSSON<<ANNA<MARIA' + '<'.repeat(19)
const SAMPLE_LINE2 = 'L898902C<3UTO6908061F9406236ZE184226B<<<<<14'

describe('MRZ TD3', () => {
  it('matches the ICAO Doc 9303-11 sample', () => {
    expect(buildMrzLines(SAMPLE)).toEqual({ line1: SAMPLE_LINE1, line2: SAMPLE_LINE2 })
  })

  it('validates every check digit of the sample', () => {
    const result = validateMrzLines({ line1: SAMPLE_LINE1, line2: SAMPLE_LINE2 })
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.checks.documentNumber).toBe('3')
    expect(result.checks.dateOfBirth).toBe('1')
    expect(result.checks.dateOfExpiry).toBe('6')
    expect(result.checks.composite).toBe('4')
  })

  it('rejects a corrupted check digit', () => {
    const broken = SAMPLE_LINE2.slice(0, 9) + '0' + SAMPLE_LINE2.slice(10)
    expect(validateMrzLines({ line1: SAMPLE_LINE1, line2: broken }).valid).toBe(false)
  })

  it('computes the 7-3-1 check digit', () => {
    expect(checkDigit('L898902C<')).toBe(3)
    expect(checkDigit('690806')).toBe(1)
    expect(checkDigit('')).toBe(0)
  })

  it('pads and sanitises MRZ values', () => {
    expect(padMrz('ab cd', 10)).toBe('AB<CD<<<<<')
  })

  it('builds the 88-byte MRZ for DG1', () => {
    expect(mrzBytes(SAMPLE)).toHaveLength(88)
  })

  it('derives the BAC key seed input', () => {
    expect(mrzInformation('L898902C', '690806', '940623')).toHaveLength(24)
  })

  it('matches the card42 sample DG1 bytes (with the corrected composite check digit)', () => {
    // The card42 Java sample hard-codes a composite check digit of 0; Doc 9303-3
    // §4.9 yields 4, which is what both this build and its `mrz` parser produce.
    const expected =
      '615B5F1F58503C55544F4552494B53534F4E3C3C414E4E413C4D415249413C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C3C4C383938393032433C3355544F3639303830363146393430363233365A45313834323236423C3C3C3C3C3134'
    expect(bytesToHex(buildDg1(SAMPLE))).toBe(expected)
  })
})
