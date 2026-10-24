/**
 * Document fixtures shared by the two e2e suites: a real DG2 photograph and a
 * complete MRZ/DG2 signing request.
 */
import { readFileSync } from 'node:fs'

/** The JPEG used for DG2 in both suites. */
export function dg2Jpeg(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./assets/dg2.jpg', import.meta.url)))
}

/** DG2 dimensions advertised alongside {@link dg2Jpeg}. */
export const DG2_WIDTH = 240
export const DG2_HEIGHT = 300

/** The MRZ used by the backend suite (valid TD3 check digits). */
export const MRZ = {
  documentCode: 'P',
  issuingState: 'XDN',
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  documentNumber: 'L898902C<',
  nationality: 'XDN',
  dateOfBirth: '690806',
  sex: 'F',
  dateOfExpiry: '300101',
  personalNumber: '',
  optionalData: '',
} as const

/** Builds a complete signing request accepted by the DSC service. */
export function signRequest(
  documentNumber: string = MRZ.documentNumber,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mrz: { ...MRZ, documentNumber },
    dg2: {
      jpeg: Buffer.from(dg2Jpeg()).toString('base64'),
      width: DG2_WIDTH,
      height: DG2_HEIGHT,
    },
    ...overrides,
  }
}
