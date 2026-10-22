import { describe, expect, it } from 'vitest'

import { bytesToHex } from '../codec/hex'
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

/** The TD1 (ID-1 card) fields from the card42 sample, using the ID document code. */
const TD1_SAMPLE: MrzFields = {
  documentCode: 'ID',
  issuingState: 'UTO',
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  documentNumber: 'D23145890',
  nationality: 'UTO',
  dateOfBirth: '740812',
  sex: 'F',
  dateOfExpiry: '120415',
}

const TD1_LINE1 = 'IDUTOD231458907' + '<'.repeat(15)
const TD1_LINE2 = '7408122F1204159UTO<<<<<<<<<<<6'
const TD1_LINE3 = 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'

describe('MRZ TD1', () => {
  it('builds the three 30-character ID card lines', () => {
    expect(buildMrzLines(TD1_SAMPLE)).toEqual({
      line1: TD1_LINE1,
      line2: TD1_LINE2,
      line3: TD1_LINE3,
    })
    expect(TD1_LINE1).toHaveLength(30)
    expect(TD1_LINE2).toHaveLength(30)
    expect(TD1_LINE3).toHaveLength(30)
  })

  it('validates the TD1 check digits and composite', () => {
    const result = validateMrzLines({
      line1: TD1_LINE1,
      line2: TD1_LINE2,
      line3: TD1_LINE3,
    })
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.format).toBe('TD1')
    expect(result.checks.documentNumber).toBe('7')
    expect(result.checks.dateOfBirth).toBe('2')
    expect(result.checks.dateOfExpiry).toBe('9')
    expect(result.checks.composite).toBe('6')
  })

  it('rejects a corrupted TD1 composite check digit', () => {
    const broken = TD1_LINE2.slice(0, 29) + '0'
    expect(validateMrzLines({ line1: TD1_LINE1, line2: broken, line3: TD1_LINE3 }).valid).toBe(
      false,
    )
  })

  it('builds the 90-byte MRZ and DG1 for ID and IP documents', () => {
    expect(mrzBytes(TD1_SAMPLE)).toHaveLength(90)
    expect(buildDg1(TD1_SAMPLE)).toHaveLength(95)

    const passportCard: MrzFields = { ...TD1_SAMPLE, documentCode: 'IP' }
    expect(mrzBytes(passportCard)).toHaveLength(90)
    expect(buildMrzLines(passportCard).line1.slice(0, 2)).toBe('IP')
  })

  it('derives the BAC key seed input from TD1 fields', () => {
    expect(mrzInformation('D23145890', '740812', '120415')).toHaveLength(24)
  })
})
