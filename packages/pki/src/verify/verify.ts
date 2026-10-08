/**
 * Verification helpers: DSC chain validation, EF.SOD verification and
 * certificate profile conformance (ICAO Doc 9303-12 §7.1.1, Doc 9303-10 §4.6.2).
 */
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

import { concat, toArrayBuffer, type Bytes } from '../codec/bytes'
import { parseTlv } from '../codec/der'
import { certificateKeyId } from '../x509/crl'
import { hashOid } from '../cms/cms'
import { hash as hashBytes, type HashName } from '../crypto/crypto'
import { bytesToHex } from '../codec/hex'
import type { CertKind } from '../x509/profile'
import * as x509 from '../x509/x509lib'

/** The result of a validation that returns a list of deviations. */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** Required and forbidden extensions per certificate kind. */
interface ProfileRules {
  required: { oid: string; critical: boolean; name: string }[]
  /** Extensions that must not be present at all. */
  forbidden: { oid: string; name: string }[]
}

const CSCA_RULES: ProfileRules = {
  required: [
    { oid: '2.5.29.14', critical: false, name: 'SubjectKeyIdentifier' },
    { oid: '2.5.29.15', critical: true, name: 'KeyUsage' },
    { oid: '2.5.29.16', critical: false, name: 'PrivateKeyUsagePeriod' },
    { oid: '2.5.29.19', critical: true, name: 'BasicConstraints' },
    { oid: '2.5.29.17', critical: false, name: 'SubjectAltName' },
    { oid: '2.5.29.18', critical: false, name: 'IssuerAltName' },
    { oid: '2.5.29.31', critical: false, name: 'CRLDistributionPoints' },
  ],
  forbidden: [
    { oid: '2.5.29.37', name: 'ExtendedKeyUsage' },
    { oid: '2.5.29.30', name: 'NameConstraints' },
    { oid: '2.5.29.36', name: 'PolicyConstraints' },
    { oid: '2.5.29.54', name: 'InhibitAnyPolicy' },
    { oid: '2.5.29.46', name: 'FreshestCRL' },
  ],
}

const DSC_RULES: ProfileRules = {
  required: [
    { oid: '2.5.29.35', critical: false, name: 'AuthorityKeyIdentifier' },
    { oid: '2.5.29.15', critical: true, name: 'KeyUsage' },
    { oid: '2.5.29.16', critical: false, name: 'PrivateKeyUsagePeriod' },
    { oid: '2.23.136.1.1.6.2', critical: false, name: 'DocumentType' },
    { oid: '2.5.29.17', critical: false, name: 'SubjectAltName' },
    { oid: '2.5.29.18', critical: false, name: 'IssuerAltName' },
    { oid: '2.5.29.31', critical: false, name: 'CRLDistributionPoints' },
  ],
  forbidden: [
    { oid: '2.5.29.37', name: 'ExtendedKeyUsage' },
    { oid: '2.5.29.19', name: 'BasicConstraints' },
  ],
}

const ML_SIGNER_RULES: ProfileRules = {
  required: [
    { oid: '2.5.29.35', critical: false, name: 'AuthorityKeyIdentifier' },
    { oid: '2.5.29.15', critical: true, name: 'KeyUsage' },
    { oid: '2.5.29.37', critical: false, name: 'ExtendedKeyUsage' },
  ],
  forbidden: [{ oid: '2.5.29.19', name: 'BasicConstraints' }],
}

function rulesFor(kind: CertKind): ProfileRules {
  switch (kind) {
    case 'csca':
    case 'link':
      return CSCA_RULES
    case 'dsc':
      return DSC_RULES
    case 'ml-signer':
      return ML_SIGNER_RULES
  }
}

/**
 * Validates a certificate against the profile for its kind and returns every
 * deviation (empty when conforming).
 */
export function validateCertProfile(
  certificate: x509.X509Certificate,
  kind: CertKind,
): ValidationResult {
  const errors: string[] = []
  const rules = rulesFor(kind)

  // Serial: positive, <= 20 bytes.
  const serial = certificate.serialNumber
  if (serial.length === 0 || serial.length > 40) {
    errors.push(`serial length out of range (${serial.length} hex characters)`)
  }

  // Subject: countryName and commonName present.
  const commonName = certificate.subjectName.getField('CN')
  const country = certificate.subjectName.getField('C')
  if (commonName.length === 0) errors.push('subject commonName is missing')
  if (country.length === 0) errors.push('subject countryName is missing')

  for (const rule of rules.required) {
    const ext = certificate.getExtension(rule.oid)
    if (!ext) {
      errors.push(`missing required extension ${rule.name} (${rule.oid})`)
    } else if (ext.critical !== rule.critical) {
      errors.push(
        `extension ${rule.name} criticality is ${ext.critical}, expected ${rule.critical}`,
      )
    }
  }
  for (const rule of rules.forbidden) {
    if (certificate.getExtension(rule.oid)) {
      errors.push(`forbidden extension ${rule.name} (${rule.oid}) is present`)
    }
  }

  // KeyUsage semantics.
  const ku = certificate.getExtension<x509.KeyUsagesExtension>('2.5.29.15')
  if (ku) {
    if (kind === 'csca' || kind === 'link') {
      const expected = x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign
      if (ku.usages !== expected) errors.push('CSCA KeyUsage must be keyCertSign + cRLSign only')
    }
    if (kind === 'dsc') {
      if (ku.usages !== x509.KeyUsageFlags.digitalSignature) {
        errors.push('DSC KeyUsage must be digitalSignature only')
      }
    }
  }
  if (kind === 'csca' || kind === 'link') {
    const bc = certificate.getExtension<x509.BasicConstraintsExtension>('2.5.29.19')
    if (bc && (!bc.ca || bc.pathLength !== 0)) {
      errors.push('CSCA BasicConstraints must be cA=TRUE with pathLenConstraint=0')
    }
  }

  return { valid: errors.length === 0, errors }
}

/** The result of verifying a DSC against a set of CSCA certificates. */
export interface DscChainResult extends ValidationResult {
  csca?: x509.X509Certificate
}

/** Verifies that a DSC was issued by one of the given CSCA certificates. */
export async function verifyDscAgainstCsca(
  dsc: x509.X509Certificate,
  cscaList: x509.X509Certificate[],
): Promise<DscChainResult> {
  const errors: string[] = []
  const aki = dsc.getExtension<x509.AuthorityKeyIdentifierExtension>('2.5.29.35')
  let issuer: x509.X509Certificate | undefined
  for (const csca of cscaList) {
    if (csca.subjectName.toString() !== dsc.issuerName.toString()) continue
    const ski = certificateKeyId(csca)
    if (aki?.keyId && ski && aki.keyId.toLowerCase() !== bytesToHex(ski).toLowerCase()) continue
    issuer = csca
    break
  }
  if (!issuer) {
    errors.push('no CSCA certificate matches the DSC issuer/AKI')
    return { valid: false, errors }
  }
  const signatureOk = await dsc.verify({
    publicKey: issuer.publicKey,
    signatureOnly: true,
  })
  if (!signatureOk) errors.push('DSC signature does not verify against the CSCA key')
  const profile = validateCertProfile(dsc, 'dsc')
  errors.push(...profile.errors)
  return { valid: errors.length === 0, errors, csca: issuer }
}

/** One parsed data-group hash from the LDS Security Object. */
export interface DgHash {
  number: number
  hash: Uint8Array
}

/** The parsed LDS Security Object. */
export interface LdsSecurityObject {
  version: number
  hashAlgorithmOid: string
  hashes: DgHash[]
}

/** Parses the LDS Security Object (Doc 9303-10 §4.6.2). */
export function parseLdsSecurityObject(bytes: Bytes): LdsSecurityObject {
  const parsed = asn1js.fromBER(toArrayBuffer(bytes))
  if (parsed.offset === -1 || !(parsed.result instanceof asn1js.Sequence)) {
    throw new Error('LDS Security Object is not a SEQUENCE')
  }
  const [version, algorithm, groupList] = parsed.result.valueBlock.value
  if (!(version instanceof asn1js.Integer) || !(groupList instanceof asn1js.Sequence)) {
    throw new Error('malformed LDS Security Object')
  }
  const algorithmSequence = algorithm as asn1js.Sequence
  const oid = algorithmSequence.valueBlock.value[0]
  if (!(oid instanceof asn1js.ObjectIdentifier)) {
    throw new Error('malformed LDS Security Object hash algorithm')
  }
  const hashes: DgHash[] = []
  for (const entry of groupList.valueBlock.value) {
    if (!(entry instanceof asn1js.Sequence)) continue
    const [number, digest] = entry.valueBlock.value
    hashes.push({
      number: (number as asn1js.Integer).valueBlock.valueDec,
      hash: new Uint8Array((digest as asn1js.OctetString).valueBlock.valueHexView),
    })
  }
  return { version: version.valueBlock.valueDec, hashAlgorithmOid: oid.getValue(), hashes }
}

/** The result of verifying an EF.SOD. */
export interface SodVerification extends ValidationResult {
  signerCertificate?: x509.X509Certificate
  hashes?: DgHash[]
  /** Data groups present in the SOD that mismatch the supplied hashes. */
  mismatchedDataGroups: number[]
}

/** Extracts the bytes of a (possibly constructed) CMS OCTET STRING. */
function octetStringBytes(value: asn1js.OctetString): Uint8Array {
  const block = value.valueBlock as unknown as {
    valueHexView?: Uint8Array
    value?: asn1js.OctetString[]
  }
  if (block.valueHexView && block.valueHexView.byteLength > 0) {
    return new Uint8Array(block.valueHexView)
  }
  if (Array.isArray(block.value)) {
    return concat(...block.value.map((child) => octetStringBytes(child)))
  }
  throw new Error('empty CMS eContent')
}

/**
 * Verifies the CMS signature of an EF.SOD and, when `dgHashes` is supplied,
 * checks each data group hash.  When `cscaList` is supplied the signer is also
 * chained to a CSCA.
 */
export async function verifySod(
  sod: Bytes,
  dgHashes?: Map<number, Uint8Array>,
  cscaList?: x509.X509Certificate[],
): Promise<SodVerification> {
  const errors: string[] = []
  const mismatchedDataGroups: number[] = []

  const node = parseTlv(sod)
  const cmsDer = node.tag === 0x77 ? node.value : sod
  const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(cmsDer))
  if (contentInfo.contentType !== '1.2.840.113549.1.7.2') {
    return { valid: false, errors: ['CMS contentType is not signedData'], mismatchedDataGroups }
  }
  const signedData = new pkijs.SignedData({ schema: contentInfo.content })
  const eContent = signedData.encapContentInfo.eContent
  if (!eContent) {
    return { valid: false, errors: ['CMS SignedData has no eContent'], mismatchedDataGroups }
  }
  const eContentBytes = octetStringBytes(eContent)

  let signerCertificate: x509.X509Certificate | undefined
  try {
    const ok = await signedData.verify({
      signer: 0,
      data: toArrayBuffer(eContentBytes),
      checkChain: false,
    })
    if (!ok) errors.push('CMS signature verification failed')
  } catch (error) {
    errors.push(`CMS verify error: ${(error as Error).message}`)
  }

  const embedded = signedData.certificates?.find(
    (cert): cert is pkijs.Certificate => cert instanceof pkijs.Certificate,
  )
  if (embedded) {
    signerCertificate = new x509.X509Certificate(embedded.toSchema().toBER(false))
    if (cscaList) {
      const chain = await verifyDscAgainstCsca(signerCertificate, cscaList)
      errors.push(...chain.errors)
    }
  } else {
    errors.push('CMS SignedData has no embedded signer certificate')
  }

  let hashes: DgHash[] | undefined
  try {
    const lso = parseLdsSecurityObject(eContentBytes)
    hashes = lso.hashes
    if (dgHashes) {
      for (const entry of lso.hashes) {
        const expected = dgHashes.get(entry.number)
        if (!expected) continue
        const algorithm = oidToHashName(lso.hashAlgorithmOid)
        if (!algorithm) {
          errors.push(`unsupported LDS hash algorithm ${lso.hashAlgorithmOid}`)
          continue
        }
        const actual = hashBytes(algorithm, expected)
        if (bytesToHex(actual) !== bytesToHex(entry.hash)) {
          mismatchedDataGroups.push(entry.number)
        }
      }
      if (mismatchedDataGroups.length > 0) {
        errors.push(`data group hash mismatch: ${mismatchedDataGroups.join(', ')}`)
      }
    }
  } catch (error) {
    errors.push(`LDS Security Object parse error: ${(error as Error).message}`)
  }

  return { valid: errors.length === 0, errors, signerCertificate, hashes, mismatchedDataGroups }
}

function oidToHashName(oid: string): HashName | null {
  const map: Record<string, HashName> = {
    [hashOid('SHA-1')]: 'SHA-1',
    [hashOid('SHA-224')]: 'SHA-224',
    [hashOid('SHA-256')]: 'SHA-256',
    [hashOid('SHA-384')]: 'SHA-384',
    [hashOid('SHA-512')]: 'SHA-512',
  }
  return map[oid] ?? null
}
