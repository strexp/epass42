/**
 * MRZ (ICAO Doc 9303-3/4) construction and validation for TD1 identity
 * documents (`ID`, `IP`) and TD3 passports (`P`), used to build DG1 and to
 * derive the BAC/PACE seed input.
 */
import { ascii, type Bytes } from '../codec/bytes'
import { documentFormatOf, type DocumentFormat } from '@epass42/shared'

/** TD3 line length (passport booklets, 2 × 44). */
export const TD3_LINE_LENGTH = 44

/** TD1 line length (ID-1 cards, 3 × 30). */
export const TD1_LINE_LENGTH = 30

/** The 7-3-1 check digit weights (Doc 9303-3 §4.9). */
const WEIGHTS = [7, 3, 1]

/** Maps an MRZ character to its check value ('<' and unknown map to 0). */
export function charValue(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55
  return 0
}

/** The 7-3-1 check digit of an MRZ field. */
export function checkDigit(field: string): number {
  let sum = 0
  for (let i = 0; i < field.length; i++) {
    sum += charValue(field[i]) * WEIGHTS[i % 3]
  }
  return sum % 10
}

/** Normalises a value to the MRZ character set and pads/truncates to a length. */
export function padMrz(value: string, length: number): string {
  const clean = (value ?? '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  if (clean.length >= length) return clean.slice(0, length)
  return clean + '<'.repeat(length - clean.length)
}

/** The name field: primary identifier `<<` secondary identifiers (Doc 9303-3 §4.6). */
export function buildNameField(surname: string, givenNames: string, length = 39): string {
  const primary = (surname ?? '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const secondary = (givenNames ?? '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const field = secondary === '' ? primary : `${primary}<<${secondary}`
  return padMrz(field, length)
}

/** The structured MRZ fields; TD3 and TD1 share the common fields. */
export interface MrzFields {
  documentCode: string
  issuingState: string
  surname: string
  givenNames: string
  documentNumber: string
  nationality: string
  /** Date of birth, YYMMDD. */
  dateOfBirth: string
  /** Sex: M, F or `<` (unspecified). */
  sex: string
  /** Date of expiry, YYMMDD. */
  dateOfExpiry: string
  /** TD3 personal number. */
  personalNumber?: string
  /** TD3 optional data. */
  optionalData?: string
  /** TD1 optional data 1 (15 characters). */
  optionalData1?: string
  /** TD1 optional data 2 (11 characters). */
  optionalData2?: string
}

/** The MRZ lines; `line3` is present only for the TD1 layout. */
export interface MrzLines {
  line1: string
  line2: string
  line3?: string
}

/** Keeps only digits and pads/truncates to a length. */
export function padDigits(value: string, length: number): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length >= length) return digits.slice(0, length)
  return digits + '0'.repeat(length - digits.length)
}

/**
 * Builds the two 44-character TD3 MRZ lines from structured fields.  Check
 * digits (including the composite) are computed here.
 */
function buildTd3MrzLines(mrz: MrzFields): MrzLines {
  const line1 =
    padMrz(mrz.documentCode || 'P', 2) +
    padMrz(mrz.issuingState, 3) +
    buildNameField(mrz.surname, mrz.givenNames)

  const documentNumber = padMrz(mrz.documentNumber, 9)
  const documentCheck = checkDigit(documentNumber).toString()
  const nationality = padMrz(mrz.nationality, 3)
  const dob = padDigits(mrz.dateOfBirth, 6)
  const dobCheck = checkDigit(dob).toString()
  const sex = padMrz(mrz.sex || '<', 1)
  const expiry = padDigits(mrz.dateOfExpiry, 6)
  const expiryCheck = checkDigit(expiry).toString()
  const personalSource = mrz.personalNumber || mrz.optionalData || ''
  const personal = padMrz(personalSource, 14)
  const personalCheck = personalSource === '' ? '<' : checkDigit(personal).toString()
  const composite = checkDigit(
    documentNumber +
      documentCheck +
      dob +
      dobCheck +
      expiry +
      expiryCheck +
      personal +
      personalCheck,
  ).toString()

  const line2 =
    documentNumber +
    documentCheck +
    nationality +
    dob +
    dobCheck +
    sex +
    expiry +
    expiryCheck +
    personal +
    personalCheck +
    composite

  return { line1, line2 }
}

/**
 * Builds the three 30-character TD1 MRZ lines (Doc 9303-4/5).  The composite
 * check digit on line 2 covers line 1 positions 6–30 and line 2 positions
 * 1–7, 9–15 and 19–29.
 */
function buildTd1MrzLines(mrz: MrzFields): MrzLines {
  const documentNumber = padMrz(mrz.documentNumber, 9)
  const documentCheck = checkDigit(documentNumber).toString()
  const optionalData1 = padMrz(mrz.optionalData1 ?? '', 15)
  const line1 =
    padMrz(mrz.documentCode || 'ID', 2) +
    padMrz(mrz.issuingState, 3) +
    documentNumber +
    documentCheck +
    optionalData1

  const dob = padDigits(mrz.dateOfBirth, 6)
  const dobCheck = checkDigit(dob).toString()
  const sex = padMrz(mrz.sex || '<', 1)
  const expiry = padDigits(mrz.dateOfExpiry, 6)
  const expiryCheck = checkDigit(expiry).toString()
  const nationality = padMrz(mrz.nationality, 3)
  const optionalData2 = padMrz(mrz.optionalData2 ?? '', 11)
  const body = dob + dobCheck + sex + expiry + expiryCheck + nationality + optionalData2
  const composite = checkDigit(
    line1.slice(5, 30) + body.slice(0, 7) + body.slice(8, 15) + body.slice(18, 29),
  ).toString()
  const line2 = body + composite
  const line3 = buildNameField(mrz.surname, mrz.givenNames, TD1_LINE_LENGTH)
  return { line1, line2, line3 }
}

/** Builds the MRZ lines for the document type in `mrz.documentCode`. */
export function buildMrzLines(mrz: MrzFields): MrzLines {
  return documentFormatOf(mrz.documentCode || 'P') === 'TD1'
    ? buildTd1MrzLines(mrz)
    : buildTd3MrzLines(mrz)
}

/** The 88-byte TD3 or 90-byte TD1 MRZ. */
export function mrzBytes(mrz: MrzFields): Bytes {
  const { line1, line2, line3 } = buildMrzLines(mrz)
  return ascii(line1 + line2 + (line3 ?? ''))
}

/** The result of validating an MRZ. */
export interface MrzValidation {
  valid: boolean
  errors: string[]
  format: DocumentFormat | null
  /** The check digits recomputed from the fields. */
  checks: {
    documentNumber: string
    dateOfBirth: string
    dateOfExpiry: string
    /** TD3 only. */
    personalNumber?: string
    composite: string
  }
}

/** Validates the TD3 lines (length, charset and all five check digits). */
function validateTd3(lines: { line1: string; line2: string }): MrzValidation {
  const errors: string[] = []
  if (lines.line1.length !== TD3_LINE_LENGTH) errors.push('line1 must be 44 characters')
  if (lines.line2.length !== TD3_LINE_LENGTH) errors.push('line2 must be 44 characters')
  if (!/^[A-Z0-9<]*$/.test(lines.line1) || !/^[A-Z0-9<]*$/.test(lines.line2)) {
    errors.push('MRZ contains characters outside A-Z, 0-9 and <')
  }

  const line2 = lines.line2
  const documentNumber = line2.slice(0, 9)
  const documentCheck = line2[9]
  const dob = line2.slice(13, 19)
  const dobCheck = line2[19]
  const expiry = line2.slice(21, 27)
  const expiryCheck = line2[27]
  const personal = line2.slice(28, 42)
  const personalCheck = line2[42]
  const compositeCheck = line2[43]

  const expected = {
    documentNumber: checkDigit(documentNumber).toString(),
    dateOfBirth: checkDigit(dob).toString(),
    dateOfExpiry: checkDigit(expiry).toString(),
    personalNumber:
      personal.trim().replace(/</g, '') === '' ? '<' : checkDigit(personal).toString(),
    composite: checkDigit(
      documentNumber +
        documentCheck +
        dob +
        dobCheck +
        expiry +
        expiryCheck +
        personal +
        personalCheck,
    ).toString(),
  }

  if (documentCheck !== expected.documentNumber) errors.push('document number check digit mismatch')
  if (dobCheck !== expected.dateOfBirth) errors.push('date of birth check digit mismatch')
  if (expiryCheck !== expected.dateOfExpiry) errors.push('date of expiry check digit mismatch')
  if (personalCheck !== expected.personalNumber) errors.push('personal number check digit mismatch')
  if (compositeCheck !== expected.composite) errors.push('composite check digit mismatch')

  return { valid: errors.length === 0, errors, format: 'TD3', checks: expected }
}

/** Validates the TD1 lines (length, charset and all four check digits). */
function validateTd1(lines: { line1: string; line2: string; line3?: string }): MrzValidation {
  const errors: string[] = []
  if (lines.line1.length !== TD1_LINE_LENGTH) errors.push('line1 must be 30 characters')
  if (lines.line2.length !== TD1_LINE_LENGTH) errors.push('line2 must be 30 characters')
  if (lines.line3 === undefined) {
    errors.push('line3 is required for the TD1 layout')
  } else if (lines.line3.length !== TD1_LINE_LENGTH) {
    errors.push('line3 must be 30 characters')
  }
  const line3 = lines.line3 ?? ''
  for (const line of [lines.line1, lines.line2, line3]) {
    if (!/^[A-Z0-9<]*$/.test(line)) {
      errors.push('MRZ contains characters outside A-Z, 0-9 and <')
      break
    }
  }
  if (lines.line1.length !== TD1_LINE_LENGTH || lines.line2.length !== TD1_LINE_LENGTH) {
    return {
      valid: false,
      errors,
      format: 'TD1',
      checks: { documentNumber: '', dateOfBirth: '', dateOfExpiry: '', composite: '' },
    }
  }

  const documentNumber = lines.line1.slice(5, 14)
  const documentCheck = lines.line1[14]
  const dob = lines.line2.slice(0, 6)
  const dobCheck = lines.line2[6]
  const expiry = lines.line2.slice(8, 14)
  const expiryCheck = lines.line2[14]
  const compositeCheck = lines.line2[29]

  const expected = {
    documentNumber: checkDigit(documentNumber).toString(),
    dateOfBirth: checkDigit(dob).toString(),
    dateOfExpiry: checkDigit(expiry).toString(),
    composite: checkDigit(
      lines.line1.slice(5, 30) +
        lines.line2.slice(0, 7) +
        lines.line2.slice(8, 15) +
        lines.line2.slice(18, 29),
    ).toString(),
  }

  if (documentCheck !== expected.documentNumber) errors.push('document number check digit mismatch')
  if (dobCheck !== expected.dateOfBirth) errors.push('date of birth check digit mismatch')
  if (expiryCheck !== expected.dateOfExpiry) errors.push('date of expiry check digit mismatch')
  if (compositeCheck !== expected.composite) errors.push('composite check digit mismatch')

  return { valid: errors.length === 0, errors, format: 'TD1', checks: expected }
}

/** Validates a TD1 or TD3 MRZ (length, charset and every check digit). */
export function validateMrzLines(lines: {
  line1: string
  line2: string
  line3?: string
}): MrzValidation {
  const isTd1 = lines.line3 !== undefined || lines.line1.length === TD1_LINE_LENGTH
  return isTd1 ? validateTd1(lines) : validateTd3(lines)
}

/**
 * MRZ_information for the BAC/PACE key seed (Doc 9303-11 §4.3.2): document
 * number (9, `<`-padded) || check digit || DOB || check digit || DOE || check
 * digit.
 */
export function mrzInformation(
  documentNumber: string,
  dateOfBirth: string,
  dateOfExpiry: string,
): Bytes {
  const document = padMrz(documentNumber, 9)
  const dob = padDigits(dateOfBirth, 6)
  const expiry = padDigits(dateOfExpiry, 6)
  return ascii(
    document +
      checkDigit(document).toString() +
      dob +
      checkDigit(dob).toString() +
      expiry +
      checkDigit(expiry).toString(),
  )
}
