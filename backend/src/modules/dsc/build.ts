/**
 * Perso builder for the DSC signing service (M7/T7.2).
 *
 * Turns a validated, structured signing request into a card42 `.perso` script:
 * DG1 is authoritative (server-built from the MRZ), the browser-encoded DG2/DG5/
 * DG7 are validated, DG3/DG4 are wrapped, DG11/12/13/16 are built server-side,
 * and the AA/CA keys, EF.CardAccess/DG14, EF.CardSecurity and EF.SOD are
 * generated here.  AA/CA private keys exist only inside the produced script and
 * are never persisted.
 */
import {
  aaPrivateKeyValue,
  ascii,
  buildCardAccess,
  buildCardSecurity,
  buildDg1,
  buildDg2,
  buildDg5,
  buildDg7,
  buildDg11,
  buildDg12,
  buildDg13Text,
  buildDg14,
  buildDg15,
  buildDg16,
  buildSecurityObject,
  buildSod,
  bytesToHex,
  fromBase64,
  generateP256KeyPair,
  generateRsaKeyPair,
  renderEmrtdScript,
  sha256,
  validateDg2,
  wrapDg3,
  wrapDg4,
  type RsaKeyPair,
} from '@pkd42/pki'
import type { SecurityOptions, SignRequest } from '@pkd42/shared'
import { AppError } from '@pkd42/shared'

/** The LDS2 roles a document may emit (empty applications by default). */
export type Lds2Role = 'travel' | 'visa' | 'biometrics'

/** Server-filled issuing fields (defaults + admin overrides). */
export interface IssuingDefaults {
  issuingState: string
  issuingAuthority: string
  personalizationDevice: string
  dg13Policy: string
  /** Document validity in years, used for the server-computed MRZ expiry. */
  validityYears: number
  /** Maximum DG2 byte size (card42 LDS1 DG2 capacity by default). */
  dg2MaxBytes: number
  /** Emit empty LDS2 applications for these roles (disabled by default). */
  lds2: { enabled: boolean; roles: Lds2Role[]; caKeyId: number }
  endorsements?: string
  /**
   * Default LDS1 security mechanisms applied when the request omits them.
   * Chip Authentication is LDS2-only (card42's LDS1 is PACE + AA).
   */
  security: SecurityOptions
}

/** The Document Signer material used to sign EF.SOD / EF.CardSecurity. */
export interface SigningMaterial {
  certPem: string
  keyPair: RsaKeyPair
}

/** The built personalization artifacts. */
export interface PersoBuildResult {
  perso: string
  /** The data group numbers present, ascending. */
  pairs: number[]
  /** Every data group built, for self-verification. */
  groups: { number: number; bytes: Uint8Array }[]
  sod: Uint8Array
  cardAccess?: Uint8Array
  cardSecurity?: Uint8Array
  /** SHA-256 of the perso text (hex). */
  sha256: string
}

/** Formats a date as `YYYYMMDDHHMMSS`. */
export function personalizationTime(date = new Date()): string {
  return (
    date.getUTCFullYear().toString().padStart(4, '0') +
    (date.getUTCMonth() + 1).toString().padStart(2, '0') +
    date.getUTCDate().toString().padStart(2, '0') +
    date.getUTCHours().toString().padStart(2, '0') +
    date.getUTCMinutes().toString().padStart(2, '0') +
    date.getUTCSeconds().toString().padStart(2, '0')
  )
}

/** Formats a date as `YYYYMMDD`. */
export function compactDate(date = new Date()): string {
  return personalizationTime(date).slice(0, 8)
}

/** Computes the MRZ document expiry (YYMMDD) from a validity in years. */
export function mrzExpiry(validityYears: number, from = new Date()): string {
  const date = new Date(from)
  date.setUTCFullYear(date.getUTCFullYear() + validityYears)
  return (
    String(date.getUTCFullYear() % 100).padStart(2, '0') +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0')
  )
}

/** Builds the DG1..DG16 set (without AA/CA) for a request. */
function buildDataGroups(
  request: SignRequest,
  profile: IssuingDefaults,
): { number: number; bytes: Uint8Array }[] {
  const groups: { number: number; bytes: Uint8Array }[] = []
  groups.push({
    number: 1,
    bytes: buildDg1({
      ...request.mrz,
      issuingState: profile.issuingState,
      nationality: profile.issuingState,
      dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
    }),
  })

  const dg2 = buildDg2(fromBase64(request.dg2.jpeg), request.dg2.width, request.dg2.height)
  validateDg2(dg2)
  if (dg2.length > profile.dg2MaxBytes) {
    throw new AppError(
      'dg2_too_large',
      `DG2 is ${dg2.length} bytes, above the ${profile.dg2MaxBytes}-byte limit`,
      413,
    )
  }
  groups.push({ number: 2, bytes: dg2 })

  if (request.dg3) groups.push({ number: 3, bytes: wrapDg3(fromBase64(request.dg3.bytes)) })
  if (request.dg4) groups.push({ number: 4, bytes: wrapDg4(fromBase64(request.dg4.bytes)) })
  if (request.dg5) groups.push({ number: 5, bytes: buildDg5(fromBase64(request.dg5.jpeg)) })
  if (request.dg7) groups.push({ number: 7, bytes: buildDg7(fromBase64(request.dg7.jpeg)) })

  if (request.dg11) {
    groups.push({
      number: 11,
      bytes: buildDg11({
        fullName: request.dg11.fullName,
        otherNames: request.dg11.otherNames,
        personalNumber: request.dg11.personalNumber,
        fullDateOfBirth: request.dg11.fullDateOfBirth,
        placeOfBirth: request.dg11.placeOfBirth,
        address: request.dg11.address,
        telephone: request.dg11.telephone,
        profession: request.dg11.profession,
        title: request.dg11.title,
        personalSummary: request.dg11.personalSummary,
        custodyInfo: request.dg11.custodyInfo,
      }),
    })
  }

  // DG12 is always produced with server-filled document details; the applicant
  // may only add other persons and a tax/exit note.
  groups.push({
    number: 12,
    bytes: buildDg12({
      issuingAuthority: profile.issuingAuthority,
      dateOfIssue: compactDate(),
      otherPersons: request.dg12?.otherPersons,
      endorsements: profile.endorsements,
      taxExit: request.dg12?.taxExit,
      personalizationTime: personalizationTime(),
      personalizationDevice: profile.personalizationDevice,
    }),
  })

  if (request.dg13) {
    groups.push({ number: 13, bytes: buildDg13Text(ascii(request.dg13.text)) })
  }

  if (request.dg16 && request.dg16.persons.length > 0) {
    groups.push({
      number: 16,
      bytes: buildDg16(
        request.dg16.persons.map((person) => ({
          name: person.name,
          telephone: person.telephone,
          address: person.address,
          dateRecorded: person.dateRecorded,
        })),
      ),
    })
  }
  return groups
}

/**
 * Builds EF.SOD, EF.CardAccess/DG14, EF.CardSecurity, the AA (DG15) and CA keys
 * and renders the `.perso` script.
 */
export async function buildPersoSigning(
  request: SignRequest,
  profile: IssuingDefaults,
  dsc: SigningMaterial,
): Promise<PersoBuildResult> {
  const groups = buildDataGroups(request, profile)
  // Security mechanisms are administrator defaults the applicant does not see.
  const security = request.security ?? profile.security

  // EF.CardAccess advertises the LDS1 PACE mechanisms (and AA, if enabled).
  // Chip Authentication is LDS2-only, so LDS1 never advertises it.
  const cardAccess = buildCardAccess({
    paceEcdhGm3des: security.paceEcdhGm3des,
    paceEcdhGmAes128: security.paceEcdhGmAes128,
    caEcdh3des: false,
    caEcdhAes128: false,
    caKeyId: profile.lds2.caKeyId,
    aa: security.aa,
  })

  // DG14 mirrors EF.CardAccess.
  groups.push({ number: 14, bytes: buildDg14(cardAccess) })

  // Active Authentication: RSA-2048 key; only the public key is published.
  let aaPrivateKey: Uint8Array | undefined
  if (security.aa) {
    const aa = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    groups.push({ number: 15, bytes: buildDg15(aa.spki) })
    aaPrivateKey = aaPrivateKeyValue(aa.modulus, aa.privateExponent)
  }

  groups.sort((a, b) => a.number - b.number)

  // EF.SOD over the SHA-256 hashes of every DG.
  const hashes = groups.map((group) => ({ number: group.number, hash: sha256(group.bytes) }))
  const sod = await buildSod(hashes, fromBase64Pem(dsc.certPem), dsc.keyPair.privateKey)

  const sections: Parameters<typeof renderEmrtdScript>[0] = [
    {
      role: 'lds1',
      documentNumber: request.mrz.documentNumber,
      dateOfBirth: request.mrz.dateOfBirth,
      dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
      dataGroups: groups,
      sod,
      aaPrivateKey,
      cardAccess,
    },
  ]

  // Optional empty LDS2 applications (disabled by default).  Chip
  // Authentication material (EF.CardAccess, EF.CardSecurity, CA key) lives in
  // the shared master file, so it is generated once and reused by every role.
  if (profile.lds2.enabled && profile.lds2.roles.length > 0) {
    const lds2Access = buildCardAccess({
      paceEcdhGm3des: true,
      paceEcdhGmAes128: false,
      caEcdh3des: true,
      caEcdhAes128: false,
      caKeyId: profile.lds2.caKeyId,
      aa: false,
    })
    const ca = generateP256KeyPair()
    const securityObject = buildSecurityObject(lds2Access, ca.spki, profile.lds2.caKeyId)
    const lds2CardSecurity = await buildCardSecurity(
      securityObject,
      fromBase64Pem(dsc.certPem),
      dsc.keyPair.privateKey,
    )
    for (const role of profile.lds2.roles) {
      sections.push({
        role,
        documentNumber: request.mrz.documentNumber,
        dateOfBirth: request.mrz.dateOfBirth,
        dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
        dataGroups: [],
        caScalar: ca.scalar,
        cardAccess: lds2Access,
        cardSecurity: lds2CardSecurity,
      })
    }
  }

  const perso = renderEmrtdScript(sections)

  return {
    perso,
    pairs: groups.map((group) => group.number),
    groups,
    sod,
    cardAccess,
    sha256: bytesToHex(sha256(ascii(perso))),
  }
}

/** Decodes a PEM certificate into DER bytes. */
function fromBase64Pem(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z0-9 ]+-----/g, '').replace(/\s/g, '')
  return fromBase64(body)
}
