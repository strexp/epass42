/**
 * MRZ (ICAO Doc 9303-3 §4) construction and validation for TD3 passports,
 * used to build DG1 and to derive the BAC/PACE seed input.
 */
import { ascii, type Bytes } from '../codec/bytes'

/** TD3 line length. */
export const TD3_LINE_LENGTH = 44

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
export function buildNameField(surname: string, givenNames: string): string {
  const primary = (surname ?? '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const secondary = (givenNames ?? '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const field = secondary === '' ? primary : `${primary}<<${secondary}`
  return padMrz(field, 39)
}

/** The structured TD3 MRZ fields. */
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
  personalNumber: string
  optionalData: string
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
export function buildMrzLines(mrz: MrzFields): { line1: string; line2: string } {
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

/** The 88-byte TD3 MRZ (line 1 + line 2). */
export function mrzBytes(mrz: MrzFields): Bytes {
  const { line1, line2 } = buildMrzLines(mrz)
  return ascii(line1 + line2)
}

/** The result of validating a TD3 MRZ pair. */
export interface MrzValidation {
  valid: boolean
  errors: string[]
  /** The check digits recomputed from the fields. */
  checks: {
    documentNumber: string
    dateOfBirth: string
    dateOfExpiry: string
    personalNumber: string
    composite: string
  }
}

/** Validates the two TD3 MRZ lines (length, charset and all five check digits). */
export function validateMrzLines(lines: { line1: string; line2: string }): MrzValidation {
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

  return { valid: errors.length === 0, errors, checks: expected }
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
