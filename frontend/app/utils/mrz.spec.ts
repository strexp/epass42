import { describe, expect, it } from 'vitest'
import { buildMrzLines, checkDigit, validMrzLines } from '~/utils/mrz'
import type { MrzFields } from '~/utils/mrz'

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

describe('client MRZ builder', () => {
  it('computes 7-3-1 check digits', () => {
    expect(checkDigit('L898902C<')).toBe(3)
    expect(checkDigit('690806')).toBe(1)
  })

  it('builds valid TD3 lines matching the server', () => {
    const lines = buildMrzLines(SAMPLE)
    expect(lines.line1).toBe('P<UTOERIKSSON<<ANNA<MARIA' + '<'.repeat(19))
    expect(lines.line2).toBe('L898902C<3UTO6908061F9406236ZE184226B<<<<<14')
    expect(validMrzLines(lines)).toBe(true)
  })
})
