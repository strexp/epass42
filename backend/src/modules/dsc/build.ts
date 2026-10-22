/**
 * Builds a card42 `.perso` script from a validated signing request (M7/T7.2):
 * server-built DG1/DG11-16, validated browser-encoded DG2/DG5/DG7, wrapped
 * DG3/DG4, plus AA/CA keys, EF.CardAccess/DG14, EF.CardSecurity and EF.SOD.
 * AA/CA private keys exist only in the script, never persisted.
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
  hash as hashBytes,
  pemToDer,
  renderEmrtdScript,
  sha256,
  validateDg2,
  wrapDg3,
  wrapDg4,
  type CertKeyPair,
  type HashName,
} from '@epass42/pki'
import {
  AppError,
  encodeAuthorization,
  hasAnyPermission,
  type DvPermissions,
  type SecurityOptions,
  type SignRequest,
} from '@epass42/shared'

import { isLds2Enabled, mergeSecurity, toSecurityOverlay } from './securityOptions'

/** A CVCA trust anchor used for Terminal Authentication personalization. */
export interface TaTrustAnchor {
  /** Certification Authority Reference. */
  car: string
  /** Effective Date, `YYMMDD`. */
  effective: string
  /** The CVCA grant used when the profile does not set its own. */
  authorization: DvPermissions
  /** EC: uncompressed public point (`04 || X || Y`). */
  publicKey?: Uint8Array
  /** RSA-PSS: modulus and exponent. */
  modulus?: Uint8Array
  exponent?: Uint8Array
}

/** The LDS2 roles a document may emit (empty applications by default). */
export type Lds2Role = 'travel' | 'visa' | 'biometrics'

/** Server-filled issuing fields (defaults + admin overrides). */
export interface IssuingDefaults {
  /**
   * The ICAO alpha-3 country code from the configuration (`countryAlpha3`).
   * The MRZ issuing state and nationality are always this value; it is not a
   * per-deployment issuing-profile setting.
   */
  countryAlpha3: string
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
  keyPair: CertKeyPair
  /** Hash for the SOD/CMS signature (defaults to SHA-256). */
  hash?: HashName
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

/** Formats a date as `YYMMDD` (CV-certificate dates). */
export function yymmdd(date = new Date()): string {
  return compactDate(date).slice(2)
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
      issuingState: profile.countryAlpha3,
      nationality: profile.countryAlpha3,
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
  trustAnchor?: TaTrustAnchor,
): Promise<PersoBuildResult> {
  const groups = buildDataGroups(request, profile)
  // Security mechanisms are administrator defaults the applicant does not see.
  const security = mergeSecurity(profile.security, toSecurityOverlay(request.security))

  const lds2Enabled = isLds2Enabled(profile.lds2)
  const paceEnabled = security.pace.ecdhGm3des || security.pace.ecdhGmAes128
  const taEnabled = security.ta.enabled
  if (taEnabled && !trustAnchor) {
    throw new AppError(
      'ta_requires_cvca',
      'Terminal Authentication needs an ECDSA CVCA trust anchor',
      500,
    )
  }
  const taAuthorization =
    taEnabled && security.ta.authorization && hasAnyPermission(security.ta.authorization)
      ? security.ta.authorization
      : trustAnchor?.authorization
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

  // EF.CardAccess advertises the selected PACE mechanisms, AA (only the ECDSA
  // variant needs an ActiveAuthenticationInfo) and Chip Authentication.  Both CA
  // profiles (ECDH 3DES and AES-128) are advertised, matching card42.
  const cardAccess = buildCardAccess({
    paceEcdhGm3des: security.pace.ecdhGm3des,
    paceEcdhGmAes128: security.pace.ecdhGmAes128,
    caEcdh3des: caEnabled,
    caEcdhAes128: caEnabled,
    caKeyId: security.ca.keyId,
    aa: security.aa.enabled && security.aa.algorithm === 'ecdsa',
    ta: taEnabled,
    aaSignatureAlgOid: AA_SIGNATURE_ALG_OIDS.ecdsaSha256,
  })

  // Active Authentication: RSA-2048 (ISO/IEC 9796-2, SHA-1 or SHA-256) or a
  // P-256 ECDSA key.  Only the public key is published (DG15).
  let aaPrivateKey: Uint8Array | undefined
  let aaEcKey: Uint8Array | undefined
  let aaAlgorithm: 'sha1' | 'sha256' | 'ecdsa' | undefined
  if (security.aa.enabled) {
    if (security.aa.algorithm === 'ecdsa') {
      const aa = generateP256KeyPair()
      groups.push({ number: 15, bytes: buildDg15(aa.spki) })
      aaEcKey = aa.scalar
      aaAlgorithm = 'ecdsa'
    } else {
      const aa = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
      groups.push({ number: 15, bytes: buildDg15(aa.spki) })
      aaPrivateKey = aaPrivateKeyValue(aa.modulus, aa.privateExponent)
      aaAlgorithm = security.aa.algorithm === 'rsaSha256' ? 'sha256' : 'sha1'
    }
  }

  // Chip Authentication: one P-256 key pair shared by every role.  The private
  // scalar is personalized as DGI FF03 and the static public key is published
  // in the master-file EF.CardSecurity (DGI FF05 for LDS1, FID 011D for LDS2).
  // Its SecurityInfos are the EF.CardAccess set plus the chip's static CA public
  // key (ChipAuthenticationPublicKeyInfo, id-PK-ECDH); DG14 reuses that set.
  let caScalar: Uint8Array | undefined
  let cardSecurity: Uint8Array | undefined
  let caSecurityObject: Uint8Array | undefined
  if (caEnabled) {
    const ca = generateP256KeyPair()
    caScalar = ca.scalar
    caSecurityObject = buildSecurityObject(cardAccess, ca.spki, security.ca.keyId)
    cardSecurity = await buildCardSecurity(
      caSecurityObject,
      pemToDer(dsc.certPem),
      dsc.keyPair.privateKey,
      dsc.hash ?? 'SHA-256',
    )
  }

  // DG14 (Security Options) = 6E { SET OF SecurityInfo } (Doc 9303-10 §4.7.14),
  // emitted only when it carries Chip or Active Authentication.  With Chip
  // Authentication it repeats the EF.CardSecurity eContent verbatim, i.e. the
  // EF.CardAccess SecurityInfos plus the chip's static CA public key; with only
  // Active Authentication there is no CA public key, so it repeats EF.CardAccess.
  if (caEnabled || security.aa.enabled || taEnabled) {
    groups.push({ number: 14, bytes: buildDg14(caSecurityObject ?? cardAccess) })
  }

  groups.sort((a, b) => a.number - b.number)

  // EF.SOD over the data-group hashes (the LDS Security Object digest algorithm
  // matches the SOD signature hash).
  const sodHash = dsc.hash ?? 'SHA-256'
  const hashes = groups.map((group) => ({
    number: group.number,
    hash: hashBytes(sodHash, group.bytes),
  }))
  const sod = await buildSod(hashes, pemToDer(dsc.certPem), dsc.keyPair.privateKey, sodHash)

  const sections: Parameters<typeof renderEmrtdScript>[0] = [
    {
      role: 'lds1',
      documentNumber: request.mrz.documentNumber,
      dateOfBirth: request.mrz.dateOfBirth,
      dateOfExpiry: request.mrz.dateOfExpiry ?? mrzExpiry(profile.validityYears),
      // The CAN is a PACE password (master-file DGI FF06); it is written only
      // for LDS1 and only when the applicant provided one (Doc 9303-11).
      can: request.can,
      dataGroups: groups,
      sod,
      aaPrivateKey,
      aaEcKey,
      aaAlgorithm,
      caScalar,
      cardAccess,
      cardSecurity,
      // Terminal Authentication: the ICC current date and the CVCA trust point
      // (package-shared on the card, so personalizing LDS1 suffices).
      taDate: taEnabled ? (security.ta.currentDate ?? yymmdd(new Date())) : undefined,
      trustPoints:
        taEnabled && trustAnchor
          ? [
              {
                car: trustAnchor.car,
                effective: trustAnchor.effective,
                authorization: encodeAuthorization(taAuthorization ?? trustAnchor.authorization),
                ...(trustAnchor.publicKey
                  ? { publicKey: trustAnchor.publicKey }
                  : { modulus: trustAnchor.modulus, exponent: trustAnchor.exponent }),
              },
            ]
          : undefined,
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
