/**
 * Card-verifiable (CV) certificates for the LDS2 authorization PKI.
 *
 * Doc 9303-12 §7.2 specifies CVCA, DV and terminal certificates as ISO/IEC 7816
 * card-verifiable certificates (tag `7F21`), not X.509.  This module builds the
 * CVCA self-signed root, CVCA link, DV and terminal certificates and parses/
 * verifies the `7F21` structure (BSI TR-03110-3 C.1):
 *
 *   CVCertificate ::= [APPLICATION 21] {           -- 7F 21
 *     body      CertificateBody                    -- 7F 4E
 *     signature OCTET STRING                       -- 5F 37
 *   }
 *   CertificateBody ::= [APPLICATION 14] {         -- 7F 4E
 *     profileIdentifier  INTEGER (0)               -- 5F 29
 *     authorityReference CHAR STRING (16)          -- 42
 *     publicKey          PublicKeyDataObject        -- 7F 49
 *     holderReference    CHAR STRING (16)          -- 5F 20
 *     chat               CHAT                       -- 7F 4C
 *     effectiveDate      DATE (YYMMDD unpacked BCD) -- 5F 25
 *     expirationDate     DATE                        -- 5F 24
 *     [extensions        AuthorizationExtensions]   -- 65
 *   }
 *
 * The signature is computed over the encoded certificate body (tag and length
 * included) using the certification authority's private key (§7.2.2.7).  EC
 * keys use ECDSA-SHA-256 with the TR-03111 plain `r||s` form; RSA keys use
 * RSA-PSS-SHA-256.
 *
 * The CHAT (`7F4C`) carries the role in the top two bits of the first
 * discretionary byte (`C0`=CVCA, `80`=domestic DV, `40`=foreign DV, `00`=
 * terminal; BSI TR-03110-4 §2.1.3.2) and the ePassport relative authorization
 * in b1/b2 (DG3/DG4).  The LDS2 read/append authorization is carried by the
 * application authorization extensions (`65 { 73 { 06 <OID>, 53 <bits> } }`,
 * Doc 9303-10 Table 99).
 */
import {
  OIDS,
  encodeAuthorization,
  emptyPermissions,
  type DvClass,
  type DvPermissions,
} from '@epass42/shared'
import * as pkijs from 'pkijs'

import { ascii, concat, toArrayBuffer, trimLeadingZeros, type Bytes } from '../codec/bytes'
import { bytesToHex } from '../codec/hex'
import { derOid, derTlv, parseSingleTlv, rsaSpki, type TlvNode } from '../codec/der'
import {
  ECDSA_P256_SHA256,
  importEcPublicKey,
  sha256,
  type EcKeyPair,
  type HashName,
  type RsaKeyPair,
} from '../crypto/crypto'
import { rsaSigningAlgorithm } from '../x509/x509'

/** The role a CV certificate is issued to. */
export type CvRole = 'cvca' | 'dv' | 'terminal'

/** A CV signing/verification key: RSA-PSS or ECDSA P-256. */
export type CvKeyPair = RsaKeyPair | EcKeyPair

/** The tags of the card-verifiable certificate data objects (Doc 9303-12 Table 14). */
export const CV_TAGS = {
  certificate: 0x7f21,
  body: 0x7f4e,
  profileIdentifier: 0x5f29,
  authorityReference: 0x42,
  publicKey: 0x7f49,
  rsaModulus: 0x81,
  rsaExponent: 0x82,
  ecPoint: 0x86,
  holderReference: 0x5f20,
  chat: 0x7f4c,
  discretionaryData: 0x53,
  effectiveDate: 0x5f25,
  expirationDate: 0x5f24,
  extensions: 0x65,
  discretionaryTemplate: 0x73,
  signature: 0x5f37,
} as const

/** The certificate profile identifier value mandated by §7.2.2.1. */
export const CV_PROFILE_IDENTIFIER = 0

/** Role bits in the most significant bits of the CHAT discretionary data. */
const ROLE_CVCA = 0xc0
const ROLE_DV_DOMESTIC = 0x80
const ROLE_DV_FOREIGN = 0x40
const ROLE_TERMINAL = 0x00

/** The certified public key (RSA components or an uncompressed EC point). */
export type CvPublicKey =
  { algorithm: 'rsa'; modulus: Bytes; publicExponent: Bytes } | { algorithm: 'ec'; point: Bytes }

/** A key usable to verify a CV certificate signature. */
export interface CvVerificationKey {
  key: CryptoKey
  algorithm: 'RSA-PSS' | 'RSASSA-PKCS1-v1_5' | 'ECDSA'
  hash: HashName
}

/** A generated CV certificate. */
export interface GeneratedCvCertificate {
  der: Bytes
  holderReference: string
  authorityReference: string
  role: CvRole
  dvClass?: DvClass
  effectiveDate: Date
  expirationDate: Date
  /** SHA-256 fingerprint of the DER encoding (lowercase hex). */
  fingerprintSha256: string
  permissions: DvPermissions
}

/** A parsed CV certificate. */
export interface ParsedCvCertificate {
  der: Bytes
  profileIdentifier: number
  authorityReference: string
  holderReference: string
  role: CvRole
  dvClass?: DvClass
  permissions: DvPermissions
  effectiveDate: Date
  expirationDate: Date
  publicKey: CvPublicKey
  /** The encoded certificate body (`7F4E`), the signed region. */
  body: Bytes
  signature: Bytes
}

/** Parameters for a CV certificate. */
export interface CvProfile {
  country: string
  holderMnemonic: string
  sequence: string
  role: CvRole
  /** Domestic (trusted) or foreign (untrusted) DV role bits. */
  dvClass?: DvClass
  permissions: DvPermissions
  notBefore: Date
  notAfter: Date
}

/** Builds a 16-character Certificate Holder/Authority Reference (Table 12). */
export function certificateReference(
  country: string,
  holderMnemonic: string,
  sequence: string,
): string {
  if (country.length !== 2) throw new Error('country code must be two characters')
  // Pad the mnemonic with '0' (not a space) so the reference is a single token
  // in the whitespace-delimited `@cvca` personalization directive.
  const mnemonic = holderMnemonic.slice(0, 9).padEnd(9, '0')
  const seq = sequence.slice(0, 5).padStart(5, '0')
  return `${country}${mnemonic}${seq}`
}

/** True when the key pair is an ECDSA key. */
export function isEcKey(key: CvKeyPair): key is EcKeyPair {
  return 'point' in key
}

/** Derives the CV public key data object from a key pair. */
export function cvPublicKeyOf(key: CvKeyPair): CvPublicKey {
  return isEcKey(key)
    ? { algorithm: 'ec', point: key.point }
    : { algorithm: 'rsa', modulus: key.modulus, publicExponent: key.publicExponent }
}

/** Left-pads an EC coordinate to the 32-byte P-256 width. */
function padCoordinate(value: Uint8Array): Bytes {
  if (value.length >= 32) return value.slice(value.length - 32)
  return concat(new Uint8Array(32 - value.length), value)
}

/** Extracts the CV public key from a DER SubjectPublicKeyInfo. */
export function cvPublicKeyFromSpki(spki: Bytes): CvPublicKey {
  const info = pkijs.PublicKeyInfo.fromBER(toArrayBuffer(spki))
  const parsed = info.parsedKey
  if (parsed instanceof pkijs.RSAPublicKey) {
    return {
      algorithm: 'rsa',
      modulus: trimLeadingZeros(new Uint8Array(parsed.modulus.valueBlock.valueHexView)),
      publicExponent: trimLeadingZeros(
        new Uint8Array(parsed.publicExponent.valueBlock.valueHexView),
      ),
    }
  }
  if (parsed instanceof pkijs.ECPublicKey) {
    return {
      algorithm: 'ec',
      point: concat(
        new Uint8Array([0x04]),
        padCoordinate(new Uint8Array(parsed.x)),
        padCoordinate(new Uint8Array(parsed.y)),
      ),
    }
  }
  throw new Error('unsupported CV public key algorithm')
}

/** Extracts the CV public key from a DER PKCS#10 certification request (CSR). */
export function cvPublicKeyFromCsr(csr: Bytes): CvPublicKey {
  const request = pkijs.CertificationRequest.fromBER(toArrayBuffer(csr))
  const spki = request.subjectPublicKeyInfo.toSchema().toBER(false)
  return cvPublicKeyFromSpki(new Uint8Array(spki))
}

/** The CHAT role bits for a role/class. */
function roleBits(role: CvRole, dvClass?: DvClass): number {
  if (role === 'cvca') return ROLE_CVCA
  if (role === 'terminal') return ROLE_TERMINAL
  return dvClass === 'foreign' ? ROLE_DV_FOREIGN : ROLE_DV_DOMESTIC
}

/** Encodes the ePassport DG3/DG4 bits into the CHAT discretionary byte. */
function chatByte(role: CvRole, dvClass: DvClass | undefined, permissions: DvPermissions): number {
  let byte = roleBits(role, dvClass)
  if (permissions.epassport.dg3) byte |= 0x01
  if (permissions.epassport.dg4) byte |= 0x02
  return byte
}

/** Encodes the CHAT (`7F4C`) with the `id-IS` template OID. */
function chatTlv(role: CvRole, dvClass: DvClass | undefined, permissions: DvPermissions): Bytes {
  return derTlv(
    CV_TAGS.chat,
    concat(
      derOid(OIDS.idIsChat),
      derTlv(CV_TAGS.discretionaryData, new Uint8Array([chatByte(role, dvClass, permissions)])),
    ),
  )
}

/** Encodes the LDS2 authorization extensions (`65 { 73 { 06, 53 } }`). */
function extensionsTlv(permissions: DvPermissions): Bytes | undefined {
  const authorization = encodeAuthorization(permissions)
  const apps: [string, number][] = [
    [OIDS.lds2TravelAuth, authorization[1]!],
    [OIDS.lds2VisaAuth, authorization[2]!],
    [OIDS.lds2BiometricsAuth, authorization[3]!],
  ]
  const templates = apps
    .filter(([, bits]) => bits !== 0)
    .map(([oid, bits]) =>
      derTlv(
        CV_TAGS.discretionaryTemplate,
        concat(derOid(oid), derTlv(CV_TAGS.discretionaryData, new Uint8Array([bits]))),
      ),
    )
  if (templates.length === 0) return undefined
  return derTlv(CV_TAGS.extensions, concat(...templates))
}

/** Encodes a date as `YYMMDD` unpacked BCD (§7.2.3.1.3). */
function bcdDate(date: Date): Bytes {
  const year = date.getUTCFullYear() % 100
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  return new Uint8Array([
    Math.floor(year / 10),
    year % 10,
    Math.floor(month / 10),
    month % 10,
    Math.floor(day / 10),
    day % 10,
  ])
}

/** Decodes an unpacked BCD `YYMMDD` date (20YY). */
function fromBcdDate(bytes: Bytes): Date {
  const digit = (index: number): number => bytes[index]! & 0x0f
  return new Date(
    Date.UTC(
      2000 + digit(0) * 10 + digit(1),
      digit(2) * 10 + digit(3) - 1,
      digit(4) * 10 + digit(5),
    ),
  )
}

/** Encodes the PublicKeyDataObject (`7F49`). */
function publicKeyTlv(publicKey: CvPublicKey): Bytes {
  if (publicKey.algorithm === 'ec') {
    return derTlv(
      CV_TAGS.publicKey,
      concat(derOid(OIDS.idTaEcdsaSha256), derTlv(CV_TAGS.ecPoint, publicKey.point)),
    )
  }
  return derTlv(
    CV_TAGS.publicKey,
    concat(
      derOid(OIDS.idTaRsaPssSha256),
      derTlv(CV_TAGS.rsaModulus, trimLeadingZeros(publicKey.modulus)),
      derTlv(CV_TAGS.rsaExponent, trimLeadingZeros(publicKey.publicExponent)),
    ),
  )
}

/** Signs bytes with an RSA-PSS-SHA-256 or ECDSA-SHA-256 key. */
async function sign(key: CvKeyPair, data: Bytes): Promise<Bytes> {
  const algorithm = isEcKey(key) ? ECDSA_P256_SHA256 : rsaSigningAlgorithm('SHA-256', true)
  return new Uint8Array(await crypto.subtle.sign(algorithm, key.privateKey, toArrayBuffer(data)))
}

/** Assembles and signs a certificate body into a `7F21` CV certificate. */
async function assemble(
  issuer: { authorityReference: string; key: CvKeyPair },
  subject: {
    holderReference: string
    publicKey: CvPublicKey
    role: CvRole
    dvClass?: DvClass
    permissions: DvPermissions
    notBefore: Date
    notAfter: Date
  },
): Promise<GeneratedCvCertificate> {
  const extensions = extensionsTlv(subject.permissions)
  const body = derTlv(
    CV_TAGS.body,
    concat(
      derTlv(CV_TAGS.profileIdentifier, new Uint8Array([CV_PROFILE_IDENTIFIER])),
      derTlv(CV_TAGS.authorityReference, ascii(issuer.authorityReference)),
      publicKeyTlv(subject.publicKey),
      derTlv(CV_TAGS.holderReference, ascii(subject.holderReference)),
      chatTlv(subject.role, subject.dvClass, subject.permissions),
      derTlv(CV_TAGS.effectiveDate, bcdDate(subject.notBefore)),
      derTlv(CV_TAGS.expirationDate, bcdDate(subject.notAfter)),
      extensions ?? new Uint8Array(0),
    ),
  )
  const signature = await sign(issuer.key, body)
  const der = derTlv(CV_TAGS.certificate, concat(body, derTlv(CV_TAGS.signature, signature)))
  return {
    der,
    holderReference: subject.holderReference,
    authorityReference: issuer.authorityReference,
    role: subject.role,
    dvClass: subject.dvClass,
    effectiveDate: subject.notBefore,
    expirationDate: subject.notAfter,
    fingerprintSha256: bytesToHex(sha256(der)),
    permissions: subject.permissions,
  }
}

/** The role/class of a `CvProfile`. */
function authorizationOf(profile: CvProfile) {
  return {
    role: profile.role,
    dvClass: profile.dvClass,
    permissions: profile.permissions,
  }
}

/**
 * Creates a self-signed CVCA certificate.  CVCA Link certificates are produced
 * with {@link createCvcaLink}.
 */
export async function createCvcaRoot(
  profile: CvProfile,
  key: CvKeyPair,
): Promise<GeneratedCvCertificate> {
  const reference = certificateReference(profile.country, profile.holderMnemonic, profile.sequence)
  return assemble(
    { authorityReference: reference, key },
    {
      holderReference: reference,
      publicKey: cvPublicKeyOf(key),
      ...authorizationOf(profile),
      notBefore: profile.notBefore,
      notAfter: profile.notAfter,
    },
  )
}

/**
 * Creates a CVCA Link certificate across a key rollover: the previous CVCA key
 * issues the new CVCA public key.
 */
export async function createCvcaLink(
  previous: { holderReference: string; key: CvKeyPair },
  profile: CvProfile,
  newKey: CvKeyPair,
): Promise<GeneratedCvCertificate> {
  const reference = certificateReference(profile.country, profile.holderMnemonic, profile.sequence)
  return assemble(
    { authorityReference: previous.holderReference, key: previous.key },
    {
      holderReference: reference,
      publicKey: cvPublicKeyOf(newKey),
      ...authorizationOf(profile),
      notBefore: profile.notBefore,
      notAfter: profile.notAfter,
    },
  )
}

/** Creates a DV or terminal certificate signed by an issuer key. */
export async function createCvCertificate(
  profile: CvProfile & { publicKey: CvPublicKey },
  issuer: { authorityReference: string; key: CvKeyPair },
): Promise<GeneratedCvCertificate> {
  const reference = certificateReference(profile.country, profile.holderMnemonic, profile.sequence)
  return assemble(issuer, {
    holderReference: reference,
    publicKey: profile.publicKey,
    ...authorizationOf(profile),
    notBefore: profile.notBefore,
    notAfter: profile.notAfter,
  })
}

/** Decodes the CHAT (`7F4C`) and the LDS2 authorization extensions into permissions. */
function parseAuthorization(body: TlvNode): {
  role: CvRole
  dvClass?: DvClass
  permissions: DvPermissions
} {
  const chat = body.children.find((child) => child.tag === CV_TAGS.chat)
  const discretionary = chat?.children.find((child) => child.tag === CV_TAGS.discretionaryData)
  if (!discretionary || discretionary.value.length < 1) {
    throw new Error('CV certificate CHAT has no discretionary data')
  }
  const byte = discretionary.value[0]!
  const bits = byte & 0xc0
  const role: CvRole = bits === ROLE_CVCA ? 'cvca' : bits === ROLE_TERMINAL ? 'terminal' : 'dv'
  const dvClass: DvClass | undefined =
    role === 'dv' ? (bits === ROLE_DV_FOREIGN ? 'foreign' : 'domestic') : undefined

  const permissions = emptyPermissions()
  permissions.epassport.dg3 = (byte & 0x01) !== 0
  permissions.epassport.dg4 = (byte & 0x02) !== 0

  const extensions = body.children.find((child) => child.tag === CV_TAGS.extensions)
  const appFor = (oid: string): 'travel' | 'visa' | 'biometrics' | undefined =>
    oid === OIDS.lds2TravelAuth
      ? 'travel'
      : oid === OIDS.lds2VisaAuth
        ? 'visa'
        : oid === OIDS.lds2BiometricsAuth
          ? 'biometrics'
          : undefined
  for (const template of extensions?.children ?? []) {
    if (template.tag !== CV_TAGS.discretionaryTemplate) continue
    const oidNode = template.children.find((child) => child.tag === 0x06)
    const bitsNode = template.children.find((child) => child.tag === CV_TAGS.discretionaryData)
    if (!oidNode || !bitsNode) continue
    const app = appFor(decodeOid(oidNode.value))
    if (!app) continue
    const value = bitsNode.value[0] ?? 0
    permissions[app].read = (value & 0x01) !== 0 || (value & 0x04) !== 0
    permissions[app].write = (value & 0x02) !== 0 || (value & 0x08) !== 0
  }
  return { role, dvClass, permissions }
}

/** True when the bytes encode a CV certificate (`7F21`). */
export function isCvCertificate(der: Bytes): boolean {
  try {
    return parseSingleTlv(der).tag === CV_TAGS.certificate
  } catch {
    return false
  }
}

/** Parses a DER-encoded CV certificate. */
export function parseCvCertificate(der: Bytes): ParsedCvCertificate {
  const root = parseSingleTlv(der)
  if (root.tag !== CV_TAGS.certificate) throw new Error('not a CV certificate')
  const bodyNode = root.children[0]
  const signatureNode = root.children[1]
  if (!bodyNode || bodyNode.tag !== CV_TAGS.body) throw new Error('CV certificate has no body')
  if (!signatureNode || signatureNode.tag !== CV_TAGS.signature) {
    throw new Error('CV certificate has no signature')
  }

  const childAt = (tag: number): TlvNode | undefined =>
    bodyNode.children.find((child) => child.tag === tag)
  const text = (node: TlvNode): string => String.fromCharCode(...node.value)

  const profileNode = childAt(CV_TAGS.profileIdentifier)
  const carNode = childAt(CV_TAGS.authorityReference)
  const chrNode = childAt(CV_TAGS.holderReference)
  const cedNode = childAt(CV_TAGS.effectiveDate)
  const cxdNode = childAt(CV_TAGS.expirationDate)
  const pukNode = childAt(CV_TAGS.publicKey)
  if (!carNode || !chrNode || !cedNode || !cxdNode || !pukNode) {
    throw new Error('CV certificate body is incomplete')
  }

  const ecPoint = pukNode.children.find((child) => child.tag === CV_TAGS.ecPoint)
  const modulus = pukNode.children.find((child) => child.tag === CV_TAGS.rsaModulus)
  const exponent = pukNode.children.find((child) => child.tag === CV_TAGS.rsaExponent)
  let publicKey: CvPublicKey
  if (ecPoint) {
    publicKey = { algorithm: 'ec', point: ecPoint.value }
  } else if (modulus && exponent) {
    publicKey = { algorithm: 'rsa', modulus: modulus.value, publicExponent: exponent.value }
  } else {
    throw new Error('CV certificate has no usable public key')
  }

  return {
    der,
    profileIdentifier: profileNode ? profileNode.value[0]! : CV_PROFILE_IDENTIFIER,
    authorityReference: text(carNode),
    holderReference: text(chrNode),
    ...parseAuthorization(bodyNode),
    effectiveDate: fromBcdDate(cedNode.value),
    expirationDate: fromBcdDate(cxdNode.value),
    publicKey,
    body: bodyNode.full,
    signature: signatureNode.value,
  }
}

/** Imports a certificate's own public key for signature verification. */
export async function cvPublicKey(certificate: ParsedCvCertificate): Promise<CvVerificationKey> {
  if (certificate.publicKey.algorithm === 'ec') {
    return {
      key: await importEcPublicKey(certificate.publicKey.point),
      algorithm: 'ECDSA',
      hash: 'SHA-256',
    }
  }
  const key = await crypto.subtle.importKey(
    'spki',
    toArrayBuffer(rsaSpki(certificate.publicKey.modulus, certificate.publicKey.publicExponent)),
    { name: 'RSA-PSS', hash: 'SHA-256' },
    true,
    ['verify'],
  )
  return { key, algorithm: 'RSA-PSS', hash: 'SHA-256' }
}

/** Verifies a CV certificate's signature against an issuer's public key. */
export async function verifyCvCertificate(
  certificate: ParsedCvCertificate,
  issuer: CvVerificationKey,
): Promise<boolean> {
  const algorithm =
    issuer.algorithm === 'ECDSA'
      ? ECDSA_P256_SHA256
      : rsaSigningAlgorithm(issuer.hash, issuer.algorithm === 'RSA-PSS')
  return crypto.subtle.verify(
    algorithm,
    issuer.key,
    toArrayBuffer(certificate.signature),
    toArrayBuffer(certificate.body),
  )
}

/** Decodes a DER OBJECT IDENTIFIER value into dotted-decimal notation. */
function decodeOid(bytes: Bytes): string {
  if (bytes.length === 0) return ''
  const first = bytes[0]!
  const parts: number[] = [Math.floor(first / 40), first % 40]
  let value = 0
  for (let i = 1; i < bytes.length; i++) {
    value = value * 128 + (bytes[i]! & 0x7f)
    if ((bytes[i]! & 0x80) === 0) {
      parts.push(value)
      value = 0
    }
  }
  return parts.join('.')
}
