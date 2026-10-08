/**
 * EF.CardAccess / EF.CardSecurity SecurityInfo construction
 * (ICAO Doc 9303-11 §9.2, BSI TR-03110-3).
 */
import type { Bytes } from '../codec/bytes'
import { derInteger, derOid, derSequence, derSet, parseTlv } from '../codec/der'

/** Protocol OIDs used in the SecurityInfo objects (card42's SecurityInfo). */
export const SECURITY_INFO_OIDS = {
  idAa: '2.23.136.1.1.5',
  idPkEcdh: '0.4.0.127.0.7.2.2.1.2',
  caDh3des: '0.4.0.127.0.7.2.2.3.1.1',
  caEcdh3des: '0.4.0.127.0.7.2.2.3.2.1',
  caDhAes128: '0.4.0.127.0.7.2.2.3.1.2',
  caEcdhAes128: '0.4.0.127.0.7.2.2.3.2.2',
  paceEcdhGm3des: '0.4.0.127.0.7.2.2.4.2.1',
  paceEcdhGmAes128: '0.4.0.127.0.7.2.2.4.2.2',
} as const

/** Standardised domain parameter id for P-256 (BSI TR-03110-3). */
const PARAM_ID_P256 = 12

/**
 * Active Authentication signature algorithm OIDs (RFC 8017) by signing-profile
 * name.  card42's card signs with ISO/IEC 9796-2 Digital Signature Scheme 1 and
 * SHA-1 (`EmrtdApplet` constructs `AaCrypto(2048, AA_SHA1)`), so SHA-1 is the
 * only profile wired up today; the announced algorithm must match.
 */
export const AA_SIGNATURE_ALG_OIDS = {
  rsaSha1: '1.2.840.113549.1.1.5',
  rsaSha256: '1.2.840.113549.1.1.11',
} as const

/** The mechanism selection stored on a signing request. */
export interface SecurityInfoSelection {
  paceEcdhGm3des: boolean
  paceEcdhGmAes128: boolean
  caEcdh3des: boolean
  caEcdhAes128: boolean
  caKeyId: number
  aa: boolean
  /** AA signature algorithm OID (default SHA-1, matching card42's card). */
  aaSignatureAlgOid?: string
}

/** PACEInfo SEQUENCE { OID, version 2, parameterId 12 } (P-256). */
function paceInfo(oid: string): Bytes {
  return derSequence(derOid(oid), derInteger(2), derInteger(PARAM_ID_P256))
}

/** ChipAuthenticationInfo SEQUENCE { OID, version 2, keyId }. */
function chipAuthenticationInfo(oid: string, keyId: number): Bytes {
  return derSequence(derOid(oid), derInteger(2), derInteger(keyId))
}

/** ActiveAuthenticationInfo SEQUENCE { OID, version 1, signatureAlgorithm }. */
function activeAuthenticationInfo(signatureAlgorithmOid: string): Bytes {
  return derSequence(derOid(SECURITY_INFO_OIDS.idAa), derInteger(1), derOid(signatureAlgorithmOid))
}

/** ChipAuthenticationPublicKeyInfo SEQUENCE { OID, SubjectPublicKeyInfo, keyId }. */
export function chipAuthenticationPublicKeyInfo(spki: Bytes, keyId: number): Bytes {
  return derSequence(derOid(SECURITY_INFO_OIDS.idPkEcdh), spki, derInteger(keyId))
}

/** The list of SecurityInfo entries selected by the document. */
function securityInfoEntries(info: SecurityInfoSelection): Bytes[] {
  const entries: Bytes[] = []
  if (info.paceEcdhGm3des) entries.push(paceInfo(SECURITY_INFO_OIDS.paceEcdhGm3des))
  if (info.paceEcdhGmAes128) entries.push(paceInfo(SECURITY_INFO_OIDS.paceEcdhGmAes128))
  if (info.caEcdh3des)
    entries.push(chipAuthenticationInfo(SECURITY_INFO_OIDS.caEcdh3des, info.caKeyId))
  if (info.caEcdhAes128) {
    entries.push(chipAuthenticationInfo(SECURITY_INFO_OIDS.caEcdhAes128, info.caKeyId))
  }
  if (info.aa) {
    entries.push(activeAuthenticationInfo(info.aaSignatureAlgOid ?? AA_SIGNATURE_ALG_OIDS.rsaSha1))
  }
  return entries
}

/** EF.CardAccess: a DER SET OF SecurityInfo. */
export function buildCardAccess(info: SecurityInfoSelection): Bytes {
  const entries = securityInfoEntries(info)
  if (entries.length === 0) throw new Error('EF.CardAccess needs at least one SecurityInfo')
  return derSet(...entries)
}

/**
 * The EF.CardSecurity eContent (`id-SecurityObject`): the CardAccess
 * SecurityInfos plus the chip's static Chip Authentication public key.
 */
export function buildSecurityObject(cardAccess: Bytes, caSpki: Bytes, keyId: number): Bytes {
  const root = parseTlv(cardAccess)
  if (root.tag !== 0x31) throw new Error('EF.CardAccess is not a DER SET')
  const entries = root.children.map((child) => child.full)
  return derSet(...entries, chipAuthenticationPublicKeyInfo(caSpki, keyId))
}
