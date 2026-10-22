/**
 * ICAO Doc 9303-12 §7.1.1 certificate profile helpers.
 *
 * This module builds the raw ASN.1 values for the extensions that have no
 * standard WebCrypto/`@peculiar/x509` builder (PrivateKeyUsagePeriod,
 * DocumentType, the directoryName SubjectAltName, NameChange) and the standard
 * extensions with the criticality the profile requires.
 */
import * as x509 from './x509lib'

import { ascii, toArrayBuffer, type Bytes } from '../codec/bytes'
import {
  derInteger,
  derOid,
  derPrintableString,
  derSequence,
  derSet,
  derTlv,
  generalizedTime,
  parseSingleTlv,
  type TlvNode,
} from '../codec/der'
import { OIDS, documentTypeCovers, normalizeDocumentType } from '@epass42/shared'

/** The certificate profile being built or validated. */
export type CertKind = 'csca' | 'dsc' | 'ml-signer' | 'link'

/** Locality value required by the CSCA SAN (`localityName=UDN`). */
export const CSCA_LOCALITY = 'UDN'

/** OIDs of the name attributes used by the directoryName SAN. */
const AT_LOCALITY_NAME = '2.5.4.7'
const AT_STATE_OR_PROVINCE_NAME = '2.5.4.8'

/** A single AttributeTypeAndValue (OID + PrintableString value). */
function attribute(oid: string, value: string): Bytes {
  return derSequence(derOid(oid), derPrintableString(value))
}

/** RDNSequence = SEQUENCE OF RelativeDistinguishedName. */
function rdnSequence(attributes: Bytes[]): Bytes {
  return derSequence(...attributes.map((atv) => derSet(atv)))
}

/**
 * GeneralName `directoryName` ([4] EXPLICIT Name).  The profile uses the
 * locality (and, when needed for uniqueness, the state or province).
 */
export function directoryNameGeneralName(locality: string, state?: string): Bytes {
  const attributes = state
    ? [attribute(AT_STATE_OR_PROVINCE_NAME, state), attribute(AT_LOCALITY_NAME, locality)]
    : [attribute(AT_LOCALITY_NAME, locality)]
  return derTlv(0xa4, rdnSequence(attributes))
}

/**
 * SubjectAltName / IssuerAltName extension value: `GeneralNames ::= SEQUENCE OF
 * GeneralName`.  For a CSCA this is a single `directoryName` with
 * `localityName=UDN`.
 */
export function cscaAltNameValue(locality = CSCA_LOCALITY, state?: string): Bytes {
  return derSequence(directoryNameGeneralName(locality, state))
}

/** SubjectAltName (nc) carrying the CSCA directoryName. */
export function cscaSubjectAltName(locality = CSCA_LOCALITY, state?: string): x509.Extension {
  return new x509.Extension(
    OIDS.subjectAltName,
    false,
    toArrayBuffer(cscaAltNameValue(locality, state)),
  )
}

/** IssuerAltName (nc); identical to the SAN for a self-signed CSCA root. */
export function cscaIssuerAltName(locality = CSCA_LOCALITY, state?: string): x509.Extension {
  return new x509.Extension(
    OIDS.issuerAltName,
    false,
    toArrayBuffer(cscaAltNameValue(locality, state)),
  )
}

/** PrivateKeyUsagePeriod (nc): `SEQUENCE { [0] notBefore, [1] notAfter }`. */
export function privateKeyUsagePeriod(notBefore: Date, notAfter?: Date): x509.Extension {
  const parts: Bytes[] = [
    derTlv(0x80, ascii(generalizedTime(notBefore))),
    ...(notAfter ? [derTlv(0x81, ascii(generalizedTime(notAfter)))] : []),
  ]
  return new x509.Extension(OIDS.privateKeyUsagePeriod, false, toArrayBuffer(derSequence(...parts)))
}

/**
 * DocumentType (nc) extension (Doc 9303-12 §7.1.1 Table 6):
 * `DocumentTypeListSyntax ::= SEQUENCE { version INTEGER(0), documentTypes
 * SET OF PrintableString(SIZE(1..2)) }`.
 *
 * `I` is a wildcard that authorizes all `I*` document types; `ID` and `IP` are
 * concrete.  The SET OF members are encoded in DER order.
 */
export function documentTypeExtension(types: string[]): x509.Extension {
  const normalized = [...new Set(types.map(normalizeDocumentType))]
  if (normalized.length < 1 || normalized.length > 2) {
    throw new Error('DocumentType list must contain one or two unique entries')
  }
  const encoded = normalized.map(derPrintableString).sort(compareDerBytes)
  const value = derSequence(derInteger(0), derSet(...encoded))
  return new x509.Extension(OIDS.idIcaoDocumentType, false, toArrayBuffer(value))
}

/** Compares two DER encodings as required for SET OF ordering (X.690 11.6). */
function compareDerBytes(a: Bytes, b: Bytes): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!
  }
  return a.length - b.length
}

/** Decodes an ASN.1 string value (PrintableString/UTF8String) as Latin-1. */
function latin1String(bytes: Bytes): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return value
}

/** The parsed DocumentType extension value. */
export interface ParsedDocumentTypeList {
  version: number | null
  documentTypes: string[]
  errors: string[]
}

/**
 * Parses and validates a DocumentType extension value.  Structural problems and
 * values outside the ePass 42 catalog are reported instead of thrown, so the
 * certificate profile validator can list every deviation.
 */
export function parseDocumentTypeValue(value: Bytes): ParsedDocumentTypeList {
  const errors: string[] = []
  let node: TlvNode
  try {
    node = parseSingleTlv(value)
  } catch {
    return { version: null, documentTypes: [], errors: ['DocumentType is not valid DER'] }
  }
  if (node.tag !== 0x30) {
    return { version: null, documentTypes: [], errors: ['DocumentType is not a SEQUENCE'] }
  }
  if (node.children.length > 2) {
    errors.push('DocumentType contains unexpected trailing elements')
  }

  const [versionNode, listNode] = node.children
  let version: number | null = null
  if (!versionNode || versionNode.tag !== 0x02) {
    errors.push('DocumentType version is missing')
  } else {
    version = versionNode.value.length > 0 ? versionNode.value[0]! : 0
    if (versionNode.value.length !== 1 || version !== 0) {
      errors.push('DocumentType version must be 0')
    }
  }

  const documentTypes: string[] = []
  if (!listNode || listNode.tag !== 0x31) {
    errors.push('DocumentType list is missing')
  } else {
    for (const child of listNode.children) {
      if (child.tag !== 0x13 && child.tag !== 0x0c) {
        errors.push(`unexpected DocumentType element tag 0x${child.tag.toString(16)}`)
        continue
      }
      documentTypes.push(latin1String(child.value))
    }
    if (documentTypes.length < 1 || documentTypes.length > 2) {
      errors.push('DocumentType list must contain one or two entries')
    }
    if (new Set(documentTypes).size !== documentTypes.length) {
      errors.push('DocumentType list contains a duplicate value')
    }
    for (const type of documentTypes) {
      try {
        normalizeDocumentType(type)
      } catch {
        errors.push(`invalid DocumentType value: ${type}`)
      }
    }
  }
  return { version, documentTypes, errors }
}

/** The normalized DocumentType values of a certificate (empty when absent). */
export function documentTypesOfCertificate(certificate: x509.X509Certificate): string[] {
  const extension = certificate.getExtension(OIDS.idIcaoDocumentType)
  if (!extension) return []
  return parseDocumentTypeValue(new Uint8Array(extension.value)).documentTypes
}

/** True when the certificate's DocumentType extension covers a document type. */
export function certificateCoversDocumentType(
  certificate: x509.X509Certificate,
  requested: string,
): boolean {
  const extension = certificate.getExtension(OIDS.idIcaoDocumentType)
  if (!extension) return false
  const parsed = parseDocumentTypeValue(new Uint8Array(extension.value))
  if (parsed.errors.length > 0) return false
  try {
    return documentTypeCovers(parsed.documentTypes, requested)
  } catch {
    return false
  }
}

/**
 * NameChange (nc) extension for CSCA link certificates.  It records the old
 * and new subject names (DirectoryName) so a relying party can chain the
 * renamed key.
 */
export function nameChangeExtension(oldName: Bytes, newName: Bytes): x509.Extension {
  const value = derSequence(derTlv(0xa0, oldName), derTlv(0xa1, newName))
  return new x509.Extension(OIDS.idIcaoNameChange, false, toArrayBuffer(value))
}

/** SubjectKeyIdentifier (nc), computed from the public key. */
export function subjectKeyIdentifier(publicKey: CryptoKey): Promise<x509.Extension> {
  return x509.SubjectKeyIdentifierExtension.create(publicKey)
}

/** AuthorityKeyIdentifier (nc), computed from the issuer's public key. */
export function authorityKeyIdentifier(publicKey: CryptoKey): Promise<x509.Extension> {
  return x509.AuthorityKeyIdentifierExtension.create(publicKey)
}

/** KeyUsage (critical). */
export function keyUsage(usages: number, critical = true): x509.Extension {
  return new x509.KeyUsagesExtension(usages, critical)
}

/** BasicConstraints (critical). */
export function basicConstraints(
  ca: boolean,
  pathLength?: number,
  critical = true,
): x509.Extension {
  return new x509.BasicConstraintsExtension(ca, pathLength, critical)
}

/** CRLDistributionPoints (nc) from a list of URIs. */
export function crlDistributionPoints(urls: string[]): x509.Extension {
  return new x509.CRLDistributionPointsExtension(urls, false)
}

/** ExtendedKeyUsage (nc) from a list of OIDs. */
export function extendedKeyUsage(oids: string[], critical = false): x509.Extension {
  return new x509.ExtendedKeyUsageExtension(oids, critical)
}

/** The ASN.1 Name (RDNSequence) for a `C`/`O`/`OU`/`CN` subject. */
export function simpleNameValue(
  commonName: string,
  country = 'XD',
  organization?: string,
  organizationalUnit?: string,
): Bytes {
  const attributes = [attribute('2.5.4.3', commonName)]
  if (organizationalUnit) attributes.push(attribute('2.5.4.11', organizationalUnit))
  if (organization) attributes.push(attribute('2.5.4.10', organization))
  attributes.push(attribute('2.5.4.6', country))
  return rdnSequence(attributes)
}
