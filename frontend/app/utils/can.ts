/**
 * PACE Card Access Number (CAN) helpers.
 *
 * A CAN is six decimal digits printed on the document data page
 * (BSI TR-03110-3 A.2.3, ICAO Doc 9303-11). PACE can also use the MRZ password,
 * so the CAN is optional: an empty value means "use the MRZ".
 */
import { canSchema } from '@epass42/shared'

/** True when the value is a valid six-digit CAN or empty (the optional case). */
export function canIsValid(can: string): boolean {
  return can === '' || canSchema.safeParse(can).success
}

/** Keeps only the first six decimal digits of arbitrary input. */
export function normaliseCan(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6)
}

/**
 * Generates a uniformly random six-digit CAN.
 *
 * Values above 249 are rejected so every digit is equally likely (the CAN is
 * printed on the document and is not a secret, but there is no reason to skew
 * it).
 */
export function randomCan(): string {
  const digits: string[] = []
  const buffer = new Uint8Array(1)
  while (digits.length < 6) {
    crypto.getRandomValues(buffer)
    if (buffer[0]! < 250) digits.push(String(buffer[0]! % 10))
  }
  return digits.join('')
}
