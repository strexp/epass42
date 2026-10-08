/**
 * CRL creation and parsing (Doc 9303-12 §7.1.4).
 *
 * A conforming CRL is version 2, carries a non-critical AuthorityKeyIdentifier
 * (equal to the issuing CSCA's SubjectKeyIdentifier) and a non-critical
 * cRLNumber, and has no delta/IDP/freshest extensions and no per-entry
 * extensions.
 */
import { bytesToHex, hexToBytes } from './hex'
import { sha256, type HashName, type RsaKeyPair } from './crypto'
import { derInteger, derSequence, derTlv, parseTlv, type TlvNode } from './der'
import { rsaSigningAlgorithm } from './x509'
import { toArrayBuffer } from './bytes'
import * as x509 from './x509lib'
import { OIDS } from '@pkd42/shared'

/** A revoked certificate entry in a CRL. */
export interface RevokedEntry {
  serialHex: string
  revocationDate: Date
}

/** Parameters for {@link createCrl}. */
export interface CrlParams {
  /** The issuing CSCA certificate (its subject is the CRL issuer). */
  issuerCertificate: x509.X509Certificate
  /** The current CSCA signing key. */
  signingKey: RsaKeyPair
  /** Monotonically increasing CRL number. */
  crlNumber: number | bigint
  thisUpdate: Date
  nextUpdate: Date
  entries: RevokedEntry[]
  hash?: HashName
  pss?: boolean
}

/** The DER/PEM of a generated CRL. */
export interface GeneratedCrl {
  crl: x509.X509Crl
  der: Uint8Array
  pem: string
  crlNumber: bigint
}

/** Reads the SKI keyid from a certificate, if present. */
export function certificateKeyId(certificate: x509.X509Certificate): Uint8Array | null {
  const ski = certificate.getExtension<x509.SubjectKeyIdentifierExtension>(
    OIDS.subjectKeyIdentifier,
  )
  if (!ski) return null
  return hexToBytes(ski.keyId)
}

/** Builds a non-critical AuthorityKeyIdentifier extension from a key id. */
function authorityKeyIdentifierFromKeyId(keyId: Uint8Array): x509.Extension {
  // AuthorityKeyIdentifier ::= SEQUENCE { keyIdentifier [0] IMPLICIT KeyIdentifier }
  const value = derSequence(derTlv(0x80, keyId))
  return new x509.Extension(OIDS.authorityKeyIdentifier, false, toArrayBuffer(value))
}

/** Builds the non-critical cRLNumber extension. */
function crlNumberExtension(crlNumber: number | bigint): x509.Extension {
  return new x509.Extension(OIDS.cRLNumber, false, toArrayBuffer(derInteger(crlNumber)))
}

/**
 * Creates a CRL.  The issuer's SubjectKeyIdentifier is reused for the
 * AuthorityKeyIdentifier so the CRL links to the correct CSCA key, including
 * after a rollover.
 */
export async function createCrl(params: CrlParams): Promise<GeneratedCrl> {
  const hash = params.hash ?? 'SHA-256'
  const pss = params.pss ?? params.signingKey.pss
  const keyId = certificateKeyId(params.issuerCertificate)
  const extensions: x509.Extension[] = [crlNumberExtension(params.crlNumber)]
  if (keyId) extensions.unshift(authorityKeyIdentifierFromKeyId(keyId))

  const crl = await x509.X509CrlGenerator.create({
    issuer: params.issuerCertificate.subjectName,
    thisUpdate: params.thisUpdate,
    nextUpdate: params.nextUpdate,
    signingAlgorithm: rsaSigningAlgorithm(hash, pss),
    signingKey: params.signingKey.privateKey,
    extensions,
    entries: params.entries.map((entry) => ({
      serialNumber: entry.serialHex,
      revocationDate: entry.revocationDate,
    })),
  })
  const der = new Uint8Array(crl.rawData)
  return {
    crl,
    der,
    pem: crl.toString('pem'),
    crlNumber: BigInt(params.crlNumber),
  }
}

/** Parses a DER CRL. */
export function parseCrl(der: Uint8Array): x509.X509Crl {
  return new x509.X509Crl(toArrayBuffer(der))
}

/** Parses a PEM CRL. */
export function parseCrlPem(pem: string): x509.X509Crl {
  return new x509.X509Crl(pem)
}

/** Fingerprint (SHA-256, hex) of a CRL. */
export function crlFingerprint(crl: x509.X509Crl): string {
  return bytesToHex(sha256(new Uint8Array(crl.rawData)))
}

/** Returns the revoked entry for a certificate serial, or null. */
export function isRevoked(crl: x509.X509Crl, serialHex: string): x509.X509CrlEntry | null {
  return crl.findRevoked(serialHex)
}

/** The CRL number recorded in a CRL, or null when absent. */
export function readCrlNumber(crl: x509.X509Crl): bigint | null {
  const ext = crl.getExtension(OIDS.cRLNumber)
  if (!ext) return null
  const node: TlvNode = parseTlv(new Uint8Array(ext.value))
  if (node.tag !== 0x02) throw new Error('malformed cRLNumber')
  let value = 0n
  for (const byte of node.value) value = (value << 8n) | BigInt(byte)
  return value
}
