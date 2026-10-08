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
} from '../codec/der'
import { OIDS } from '@epass42/shared'

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
 */
export function documentTypeExtension(types: string[]): x509.Extension {
  if (types.length < 1 || types.length > 2) {
    throw new Error('DocumentType list must contain one or two entries')
  }
  for (const type of types) {
    if (type.length < 1 || type.length > 2) {
      throw new Error(`invalid DocumentType value: ${type}`)
    }
  }
  const value = derSequence(derInteger(0), derSet(...types.map(derPrintableString)))
  return new x509.Extension(OIDS.idIcaoDocumentType, false, toArrayBuffer(value))
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

/** The ASN.1 Name (RDNSequence) for a `C`/`CN` subject, used by NameChange. */
export function simpleNameValue(commonName: string, country = 'XD'): Bytes {
  return rdnSequence([attribute('2.5.4.6', country), attribute('2.5.4.3', commonName)])
}
