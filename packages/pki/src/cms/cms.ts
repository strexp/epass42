/**
 * CMS SignedData construction for EF.SOD, EF.CardSecurity and the CSCA Master
 * List (ICAO Doc 9303-10 §4.6.2, Doc 9303-12 §9).
 *
 * SignedData/certificate handling is delegated to `pkijs` (RFC 5652); the LDS
 * Security Object, an ICAO-private structure, is assembled with `asn1js`.
 */
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

import { toArrayBuffer, type Bytes } from '../codec/bytes'
import { derTlv } from '../codec/der'
import { hash as hashBytes, type HashName } from '../crypto/crypto'
import { OIDS } from '@pkd42/shared'

/** The eMRTD CMS content types. */
export const CMS_OIDS = {
  signedData: OIDS.cmsSignedData,
  ldsSecurityObject: OIDS.ldsSecurityObject,
  contentType: OIDS.cmsContentType,
  messageDigest: OIDS.cmsMessageDigest,
  signingTime: OIDS.cmsSigningTime,
  securityObject: OIDS.securityObject,
  cscaMasterList: OIDS.idIcaoCscaMasterList,
} as const

/** The OID used for a hash algorithm name. */
export function hashOid(name: HashName): string {
  switch (name) {
    case 'SHA-1':
      return OIDS.sha1
    case 'SHA-224':
      return OIDS.sha224
    case 'SHA-256':
      return OIDS.sha256
    case 'SHA-384':
      return OIDS.sha384
    case 'SHA-512':
      return OIDS.sha512
  }
}

/** Parameters for {@link buildCms}. */
export interface CmsOptions {
  eContentType: string
  eContent: Bytes
  /** DER of the signer (DSC / Master List Signer) certificate. */
  signerCertificate: Bytes
  /** WebCrypto private key (RSA-PSS or PKCS#1 v1.5). */
  signerPrivateKey: CryptoKey
  hash?: HashName
  /** Adds the RFC 5652 signingTime signed attribute (required for Master Lists). */
  signingTime?: Date
}

/**
 * Builds a CMS SignedData ContentInfo over an arbitrary eContent, signed by the
 * Document Signer.  `signedAttrs` always contains `content-type` and
 * `message-digest`, and optionally `signing-time`.
 */
export async function buildCms(options: CmsOptions): Promise<Bytes> {
  const hashName = options.hash ?? 'SHA-256'
  const certificate = pkijs.Certificate.fromBER(toArrayBuffer(options.signerCertificate))
  const messageDigest = hashBytes(hashName, options.eContent)

  const attributes: pkijs.Attribute[] = [
    new pkijs.Attribute({
      type: CMS_OIDS.contentType,
      values: [new asn1js.ObjectIdentifier({ value: options.eContentType })],
    }),
    new pkijs.Attribute({
      type: CMS_OIDS.messageDigest,
      values: [new asn1js.OctetString({ valueHex: toArrayBuffer(messageDigest) })],
    }),
  ]
  if (options.signingTime) {
    attributes.push(
      new pkijs.Attribute({
        type: CMS_OIDS.signingTime,
        values: [new asn1js.UTCTime({ valueDate: options.signingTime })],
      }),
    )
  }

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes })

  // Build the encapsulated content as a *primitive* OCTET STRING.  pkijs's
  // EncapsulatedContentInfo constructor rewrites a primitive eContent into a
  // constructed OCTET STRING (to support streaming); that BER form is not what
  // card42's CmsSignedData expects, so assign the primitive form afterwards.
  const encapContentInfo = new pkijs.EncapsulatedContentInfo({
    eContentType: options.eContentType,
  })
  encapContentInfo.eContent = new asn1js.OctetString({
    valueHex: toArrayBuffer(options.eContent),
  })

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo,
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: certificate.issuer,
          serialNumber: certificate.serialNumber,
        }),
        signedAttrs,
      }),
    ],
    certificates: [certificate],
  })
  await signedData.sign(options.signerPrivateKey, 0, hashName)

  const contentInfo = new pkijs.ContentInfo({
    contentType: CMS_OIDS.signedData,
    content: signedData.toSchema(true),
  })
  return new Uint8Array(contentInfo.toSchema().toBER(false))
}

/** AlgorithmIdentifier SEQUENCE { OID, NULL }. */
function algorithmIdentifier(oid: string): asn1js.Sequence {
  return new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: oid }), new asn1js.Null()],
  })
}

/** The LDS Security Object (Doc 9303-10 §4.6.2): version, hash algorithm, hashes. */
export function ldsSecurityObject(
  hashes: { number: number; hash: Bytes }[],
  hashName: HashName = 'SHA-256',
): Bytes {
  const entries = [...hashes]
    .sort((a, b) => a.number - b.number)
    .map(
      (entry) =>
        new asn1js.Sequence({
          value: [
            new asn1js.Integer({ value: entry.number }),
            new asn1js.OctetString({ valueHex: toArrayBuffer(entry.hash) }),
          ],
        }),
    )
  const sequence = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 0 }),
      algorithmIdentifier(hashOid(hashName)),
      new asn1js.Sequence({ value: entries }),
    ],
  })
  return new Uint8Array(sequence.toBER(false))
}

/**
 * EF.SOD: the CMS ContentInfo over the LDS Security Object, wrapped in the outer
 * tag `77` (Doc 9303-10 §4.6.2 Table 36).
 */
export async function buildSod(
  hashes: { number: number; hash: Bytes }[],
  signerCertificate: Bytes,
  signerPrivateKey: CryptoKey,
  hashName: HashName = 'SHA-256',
): Promise<Bytes> {
  const eContent = ldsSecurityObject(hashes, hashName)
  const cms = await buildCms({
    eContentType: CMS_OIDS.ldsSecurityObject,
    eContent,
    signerCertificate,
    signerPrivateKey,
    hash: hashName,
  })
  return derTlv(0x77, cms)
}

/** EF.CardSecurity: the raw (unwrapped) SignedData over the SecurityObject. */
export async function buildCardSecurity(
  securityObject: Bytes,
  signerCertificate: Bytes,
  signerPrivateKey: CryptoKey,
  hashName: HashName = 'SHA-256',
): Promise<Bytes> {
  return buildCms({
    eContentType: CMS_OIDS.securityObject,
    eContent: securityObject,
    signerCertificate,
    signerPrivateKey,
    hash: hashName,
  })
}
