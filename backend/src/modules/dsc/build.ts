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
  AA_SIGNATURE_ALG_OIDS,
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
  pemToDer,
  renderEmrtdScript,
  sha256,
  validateDg2,
  wrapDg3,
  wrapDg4,
  type RsaKeyPair,
} from '@epass42/pki'
import type { SecurityOptions, SignRequest } from '@epass42/shared'
import { AppError } from '@epass42/shared'

import { isLds2Enabled, mergeSecurity, toSecurityOverlay } from './securityOptions'

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
  lds2: { enabled: boolean; roles: Lds2Role[] }
  endorsements?: string
  /**
   * Default security mechanisms and algorithms applied when the request omits
   * them.  PACE and Chip Authentication are shared by LDS1 and LDS2 through the
   * master file; AA is LDS1-only.
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
  const security = mergeSecurity(profile.security, toSecurityOverlay(request.security))

  const lds2Enabled = isLds2Enabled(profile.lds2)
  const paceEnabled = security.pace.ecdhGm3des || security.pace.ecdhGmAes128
  // EF.CardAccess and EF.CardSecurity live in the master file (Doc 9303-10
  // §3.11.3/§3.11.4), so LDS1 and the LDS2 applications share one CA key pair
  // and one EF.CardSecurity.  Chip Authentication is emitted when the
  // administrator enables it for LDS1 or when any LDS2 application (which
  // always carries it) is emitted, and it always needs PACE to read
  // EF.CardSecurity.
  const caEnabled = security.ca.enabled || lds2Enabled
  if (caEnabled && !paceEnabled) {
    throw new AppError(
      'pace_required',
      'Chip Authentication requires at least one PACE profile',
      400,
    )
  }
  if (!paceEnabled && !caEnabled && !security.aa.enabled) {
    throw new AppError('no_security_mechanism', 'at least one security mechanism is required', 400)
  }

  // EF.CardAccess advertises the selected PACE mechanisms, AA (if enabled) and
  // Chip Authentication (if enabled).
  const cardAccess = buildCardAccess({
    paceEcdhGm3des: security.pace.ecdhGm3des,
    paceEcdhGmAes128: security.pace.ecdhGmAes128,
    caEcdh3des: caEnabled,
    caEcdhAes128: false,
    caKeyId: security.ca.keyId,
    aa: security.aa.enabled,
    aaSignatureAlgOid: AA_SIGNATURE_ALG_OIDS[security.aa.algorithm],
  })

  // DG14 (Security Options) is emitted only when it carries Chip or Active
  // Authentication; a PACE-only document keeps the SecurityInfos in the
  // master-file EF.CardAccess alone.
  if (caEnabled || security.aa.enabled) {
    groups.push({ number: 14, bytes: buildDg14(cardAccess) })
  }

  // Active Authentication: RSA-2048 key; only the public key is published.
  let aaPrivateKey: Uint8Array | undefined
  if (security.aa.enabled) {
    const aa = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    groups.push({ number: 15, bytes: buildDg15(aa.spki) })
    aaPrivateKey = aaPrivateKeyValue(aa.modulus, aa.privateExponent)
  }

  // Chip Authentication: one P-256 key pair shared by every role.  The private
  // scalar is personalized as DGI FF03 and the static public key is published
  // in the master-file EF.CardSecurity (DGI FF05 for LDS1, FID 011D for LDS2).
  let caScalar: Uint8Array | undefined
  let cardSecurity: Uint8Array | undefined
  if (caEnabled) {
    const ca = generateP256KeyPair()
    caScalar = ca.scalar
    const securityObject = buildSecurityObject(cardAccess, ca.spki, security.ca.keyId)
    cardSecurity = await buildCardSecurity(
      securityObject,
      pemToDer(dsc.certPem),
      dsc.keyPair.privateKey,
    )
  }

  groups.sort((a, b) => a.number - b.number)

  // EF.SOD over the SHA-256 hashes of every DG.
  const hashes = groups.map((group) => ({ number: group.number, hash: sha256(group.bytes) }))
  const sod = await buildSod(hashes, pemToDer(dsc.certPem), dsc.keyPair.privateKey)

  const sections: Parameters<typeof renderEmrtdScript>[0] = [
    {
      role: 'lds1',
      documentNumber: request.mrz.documentNumber,
      dateOfBirth: request.mrz.dateOfBirth,
      dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
      dataGroups: groups,
      sod,
      aaPrivateKey,
      caScalar,
      cardAccess,
      cardSecurity,
    },
  ]

  // Optional empty LDS2 applications (disabled by default).  They reuse the
  // master-file Chip Authentication material generated above.
  if (lds2Enabled) {
    for (const role of profile.lds2.roles) {
      sections.push({
        role,
        documentNumber: request.mrz.documentNumber,
        dateOfBirth: request.mrz.dateOfBirth,
        dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
        dataGroups: [],
        caScalar,
        cardAccess,
        cardSecurity,
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
