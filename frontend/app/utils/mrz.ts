/**
 * Client-side TD3 MRZ helpers for the live preview (T11.5).
 *
 * The server remains authoritative (it rebuilds DG1 from the structured MRZ);
 * this mirrors `@pkd42/pki`'s MRZ builder so the form can show the resulting
 * lines and check digits as the applicant types.
 */
export interface MrzFields {
  documentCode: string
  issuingState: string
  surname: string
  givenNames: string
  documentNumber: string
  nationality: string
  dateOfBirth: string
  sex: string
  dateOfExpiry: string
  personalNumber: string
  optionalData: string
}

const WEIGHTS = [7, 3, 1]

function charValue(c: string | undefined): number {
  if (!c) return 0
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55
  return 0
}

/** The 7-3-1 check digit of an MRZ field. */
export function checkDigit(field: string): number {
  let sum = 0
  for (let i = 0; i < field.length; i++) sum += charValue(field[i]) * (WEIGHTS[i % 3] ?? 0)
  return sum % 10
}

function padMrz(value: string | undefined, length: number): string {
  const clean = (value || '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  return clean.length >= length ? clean.slice(0, length) : clean + '<'.repeat(length - clean.length)
}

function padDigits(value: string | undefined, length: number): string {
  const digits = (value || '').replace(/\D/g, '')
  return digits.length >= length
    ? digits.slice(0, length)
    : digits + '0'.repeat(length - digits.length)
}

/** Builds the two 44-character TD3 lines with all check digits. */
export function buildMrzLines(mrz: MrzFields): { line1: string; line2: string } {
  const primary = (mrz.surname || '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const secondary = (mrz.givenNames || '').toUpperCase().replace(/[^A-Z0-9<]/g, '<')
  const nameField = padMrz(secondary === '' ? primary : `${primary}<<${secondary}`, 39)
  const line1 = padMrz(mrz.documentCode || 'P', 2) + padMrz(mrz.issuingState, 3) + nameField

  const documentNumber = padMrz(mrz.documentNumber, 9)
  const documentCheck = String(checkDigit(documentNumber))
  const nationality = padMrz(mrz.nationality, 3)
  const dob = padDigits(mrz.dateOfBirth, 6)
  const dobCheck = String(checkDigit(dob))
  const sex = padMrz(mrz.sex || '<', 1)
  const expiry = padDigits(mrz.dateOfExpiry, 6)
  const expiryCheck = String(checkDigit(expiry))
  const personalSource = mrz.personalNumber || mrz.optionalData || ''
  const personal = padMrz(personalSource, 14)
  const personalCheck = personalSource === '' ? '<' : String(checkDigit(personal))
  const composite = String(
    checkDigit(
      documentNumber +
        documentCheck +
        dob +
        dobCheck +
        expiry +
        expiryCheck +
        personal +
        personalCheck,
    ),
  )

  return {
    line1,
    line2:
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
      composite,
  }
}

/** Validates that the built lines have the right length and charset. */
export function validMrzLines(lines: { line1: string; line2: string }): boolean {
  return (
    lines.line1.length === 44 &&
    lines.line2.length === 44 &&
    /^[A-Z0-9<]+$/.test(lines.line1) &&
    /^[A-Z0-9<]+$/.test(lines.line2)
  )
}
