/**
 * Document fixtures shared by the two e2e suites: a real DG2 photograph and
 * complete MRZ / data-group signing requests.
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

/** A valid TD1 (ID-1) MRZ field set. */
export const TD1_MRZ = {
  documentCode: 'ID',
  issuingState: 'XDN',
  surname: 'ERIKSSON',
  givenNames: 'ANNA MARIA',
  documentNumber: 'ID1234567',
  nationality: 'XDN',
  dateOfBirth: '690806',
  sex: 'F',
  dateOfExpiry: '300101',
  optionalData1: '',
  optionalData2: '',
} as const

/**
 * Inner DG3/DG4 templates (the `7F61` group already encoded by the browser),
 * matching the card42 sample scripts.
 */
export const DG3_INNER_BASE64 = Buffer.from(
  '7F611D0201017F60175F2E140102030405060708090A0B0C0D0E0F1011121314',
  'hex',
).toString('base64')

/** Inner DG4 template (iris). */
export const DG4_INNER_BASE64 = Buffer.from(
  '7F61190201017F60135F2E102122232425262728292A2B2C2D2E2F30',
  'hex',
).toString('base64')

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

/** Builds a TD1 (ID-1 card) signing request with valid check digits. */
export function td1SignRequest(
  documentNumber: string = TD1_MRZ.documentNumber,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return signRequest(documentNumber, {
    mrz: { ...TD1_MRZ, documentNumber },
    ...overrides,
  })
}

/**
 * A request that exercises every optional data group, a CAN and the
 * PACE/AA/CA security profile.  Used by the card42 trip.
 */
export function richSignRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return signRequest(MRZ.documentNumber, {
    can: '123456',
    dg3: { bytes: DG3_INNER_BASE64 },
    dg4: { bytes: DG4_INNER_BASE64 },
    dg5: { jpeg: Buffer.from(dg2Jpeg()).toString('base64') },
    dg7: { jpeg: Buffer.from(dg2Jpeg()).toString('base64') },
    dg11: {
      fullName: 'ERIKSSON ANNA MARIA',
      personalNumber: 'XDN0000001',
      placeOfBirth: 'STOCKHOLM',
      address: '1 TEST STREET',
    },
    dg12: { otherPersons: ['TEST PERSON'], taxExit: 'NONE' },
    dg13: { text: 'pkd42 x card42 e2e' },
    dg16: { persons: [{ name: 'CONTACT PERSON', telephone: '+41000000000' }] },
    security: {
      pace: { ecdhGm3des: true, ecdhGmAes128: true },
      aa: { enabled: true, algorithm: 'ecdsa' },
      ca: { enabled: true, keyId: 1 },
      ta: { enabled: true },
    },
    ...overrides,
  })
}
