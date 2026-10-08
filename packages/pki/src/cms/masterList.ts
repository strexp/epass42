/**
 * CSCA Master List construction (ICAO Doc 9303-12 §9).
 *
 * A Master List is a CMS SignedData whose eContent is
 * `CscaMasterList ::= SEQUENCE { version INTEGER(0), SET OF Certificate }`,
 * signed by a Master List Signer (EKU id-icao-cscaMasterListSigningKey).  The
 * `certificates` set MUST contain the Master List Signer and SHOULD contain the
 * CSCA certificates.
 */
import { bytesEqual, type Bytes } from '../codec/bytes'
import { derInteger, derSequence, derSet } from '../codec/der'
import { buildCms, CMS_OIDS } from './cms'
import type { HashName } from '../crypto/crypto'

/** Parameters for {@link buildMasterList}. */
export interface MasterListOptions {
  /** DER of the CSCA certificates to publish (current and link certificates). */
  cscaCertificates: Bytes[]
  /** DER of the Master List Signer certificate. */
  signerCertificate: Bytes
  signerPrivateKey: CryptoKey
  hash?: HashName
  signingTime?: Date
}

/** The DER of the CscaMasterList eContent. */
export function masterListContent(cscaCertificates: Bytes[], signerCertificate: Bytes): Bytes {
  const all: Bytes[] = [signerCertificate, ...cscaCertificates].filter(
    (cert, index, list) => list.findIndex((other) => bytesEqual(other, cert)) === index,
  )
  // SET OF Certificate is encoded as DER SET; certificate DER is sorted by DER.
  all.sort(compareBytes)
  return derSequence(derInteger(0), derSet(...all))
}

/** Lexicographic byte comparison (for DER SET OF ordering). */
function compareBytes(a: Bytes, b: Bytes): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/**
 * Builds a signed CSCA Master List.
 */
export async function buildMasterList(options: MasterListOptions): Promise<Bytes> {
  const eContent = masterListContent(options.cscaCertificates, options.signerCertificate)
  return buildCms({
    eContentType: CMS_OIDS.cscaMasterList,
    eContent,
    signerCertificate: options.signerCertificate,
    signerPrivateKey: options.signerPrivateKey,
    hash: options.hash,
    signingTime: options.signingTime ?? new Date(),
  })
}
