/**
 * X.509 certificate creation and parsing for the ICAO Doc 9303-12 profile.
 *
 * Certificate construction/signing is delegated to `@peculiar/x509`; this
 * module assembles the CSCA, DSC and CSCA Link certificates with the required
 * extensions (see `profile.ts`).
 */
import { toArrayBuffer } from '../codec/bytes'
import { bytesToHex } from '../codec/hex'
import {
  sha256,
  type EcKeyPair,
  type HashName,
  type RsaKeyPair,
  randomSerial,
} from '../crypto/crypto'
import {
  authorityKeyIdentifier,
  basicConstraints,
  cscaIssuerAltName,
  cscaSubjectAltName,
  crlDistributionPoints,
  documentTypeExtension,
  extendedKeyUsage,
  keyUsage,
  nameChangeExtension,
  privateKeyUsagePeriod,
  simpleNameValue,
  subjectKeyIdentifier,
} from './profile'
import * as x509 from './x509lib'
import { OIDS } from '@epass42/shared'

/** Maps a hash name to its signature salt length (RSA-PSS). */
function saltLength(hash: HashName): number {
  switch (hash) {
    case 'SHA-1':
      return 20
    case 'SHA-224':
      return 28
    case 'SHA-256':
      return 32
    case 'SHA-384':
      return 48
    case 'SHA-512':
      return 64
  }
}

/** The WebCrypto signature algorithm for RSA (PSS or PKCS#1 v1.5). */
export function rsaSigningAlgorithm(
  hash: HashName,
  pss: boolean,
): RsaPssParams | EcdsaParams | Algorithm {
  return pss
    ? { name: 'RSA-PSS', hash, saltLength: saltLength(hash) }
    : { name: 'RSASSA-PKCS1-v1_5', hash }
}

/** A certificate/CRL signing key: RSA or ECDSA. */
export type CertKeyPair = RsaKeyPair | EcKeyPair

/** True for an ECDSA key pair. */
export function isEcCertKey(key: CertKeyPair): key is EcKeyPair {
  return 'point' in key
}

/** The WebCrypto signature algorithm for a certificate/CRL signer. */
export function certificateSigningAlgorithm(
  key: CertKeyPair,
  hash: HashName,
): RsaPssParams | EcdsaParams | Algorithm {
  return isEcCertKey(key) ? { name: 'ECDSA', hash } : rsaSigningAlgorithm(hash, key.pss)
}

/** Common parameters for a CSCA root or link certificate. */
export interface CscaProfile {
  commonName: string
  country?: string
  /** Optional organisation name (encoded as an `O` attribute). */
  organization?: string
  /** Optional organisational unit (encoded as an `OU` attribute). */
  organizationalUnit?: string
  /** Locality used in the SAN directoryName (profiled as `UDN`). */
  locality?: string
  /** Optional state/province when the locality alone is not unique. */
  state?: string
  notBefore: Date
  notAfter: Date
  /** End of the CSCA private key usage period (private key usage period ext). */
  privateKeyNotAfter?: Date
  serial?: Uint8Array
  crlDistributionPoints: string[]
  pss?: boolean
  hash?: HashName
}

/** Parameters for a Document Signer certificate. */
export interface DscProfile {
  commonName: string
  country?: string
  /** Optional organisation name (encoded as an `O` attribute). */
  organization?: string
  /** Optional organisational unit (encoded as an `OU` attribute). */
  organizationalUnit?: string
  /** Authorised DocumentType values, e.g. `['P', 'I']` (Doc 9303-12 §7.1.1). */
  documentTypes: string[]
  notBefore: Date
  notAfter: Date
  privateKeyNotAfter?: Date
  serial?: Uint8Array
  crlDistributionPoints: string[]
  issuancePolicy?: string
  pss?: boolean
  hash?: HashName
}

/** Parameters for a Master List Signer certificate (no DocumentType). */
export type MasterListSignerProfile = Omit<DscProfile, 'documentTypes'>

/** The DER/PEM and metadata of a generated certificate. */
export interface GeneratedCertificate {
  certificate: x509.X509Certificate
  der: Uint8Array
  pem: string
  serialHex: string
  /** SHA-256 fingerprint of the DER encoding (lowercase hex). */
  fingerprintSha256: string
}

/** Encodes a name string (`CN=...,OU=...,O=...,C=...`). */
function nameOf(
  commonName: string,
  country = 'XD',
  organization?: string,
  organizationalUnit?: string,
): x509.Name {
  const parts = [`CN=${commonName}`]
  if (organizationalUnit) parts.push(`OU=${organizationalUnit}`)
  if (organization) parts.push(`O=${organization}`)
  parts.push(`C=${country}`)
  return new x509.Name(parts.join(','))
}

/** Wraps a `@peculiar/x509` certificate with its encodings and fingerprint. */
export async function describeCertificate(
  certificate: x509.X509Certificate,
): Promise<GeneratedCertificate> {
  const der = new Uint8Array(certificate.rawData)
  const fingerprint = bytesToHex(sha256(der))
  return {
    certificate,
    der,
    pem: certificate.toString('pem'),
    serialHex: certificate.serialNumber,
    fingerprintSha256: fingerprint,
  }
}

/**
 * Creates a self-signed CSCA root certificate (Doc 9303-12 §7.1.1 Table 6).
 *
 * Required: SKI(nc), KeyUsage(c, keyCertSign+cRLSign), PrivateKeyUsagePeriod(nc),
 * BasicConstraints(c, cA=TRUE, pathlen=0), SAN(nc, localityName=UDN),
 * IssuerAltName(nc, identical to SAN), CRLDistributionPoints(nc).
 * Optional: AKI(nc, includes at least the keyid for a self-signed root).
 */
export async function createCscaRoot(
  profile: CscaProfile,
  key: CertKeyPair,
): Promise<GeneratedCertificate> {
  const hash = profile.hash ?? 'SHA-256'
  const extensions = [
    await subjectKeyIdentifier(key.publicKey),
    await authorityKeyIdentifier(key.publicKey),
    keyUsage(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign),
    privateKeyUsagePeriod(profile.notBefore, profile.privateKeyNotAfter ?? profile.notAfter),
    basicConstraints(true, 0),
    cscaSubjectAltName(profile.locality, profile.state),
    cscaIssuerAltName(profile.locality, profile.state),
    crlDistributionPoints(profile.crlDistributionPoints),
  ]
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    keys: { publicKey: key.publicKey, privateKey: key.privateKey },
    name: nameOf(
      profile.commonName,
      profile.country,
      profile.organization,
      profile.organizationalUnit,
    ),
    serialNumber: bytesToHex(profile.serial ?? randomSerial()),
    notBefore: profile.notBefore,
    notAfter: profile.notAfter,
    signingAlgorithm: certificateSigningAlgorithm(key, hash),
    extensions,
  })
  return describeCertificate(certificate)
}

/** The public-key material needed to certify a subject. */
export interface SubjectPublicKey {
  publicKey: CryptoKey
  /** Whether the subject key is an RSA-PSS key (signature algorithm hint). */
  pss?: boolean
}

/**
 * Creates a Document Signer certificate signed by the CSCA (Doc 9303-12
 * §7.1.1 Table 6).  The DSC profile forbids ExtendedKeyUsage and
 * BasicConstraints and allows only `digitalSignature` in KeyUsage.
 */
export async function createDsc(
  profile: DscProfile,
  subjectKey: SubjectPublicKey,
  issuer: { certificate: x509.X509Certificate; key: CertKeyPair; hash?: HashName },
): Promise<GeneratedCertificate> {
  const hash = issuer.hash ?? profile.hash ?? 'SHA-256'
  const extensions = [
    await authorityKeyIdentifier(issuer.key.publicKey),
    await subjectKeyIdentifier(subjectKey.publicKey),
    keyUsage(x509.KeyUsageFlags.digitalSignature),
    privateKeyUsagePeriod(profile.notBefore, profile.privateKeyNotAfter ?? profile.notAfter),
    documentTypeExtension(profile.documentTypes),
    cscaSubjectAltName(),
    cscaIssuerAltName(),
    crlDistributionPoints(profile.crlDistributionPoints),
  ]
  const subject = nameOf(
    profile.commonName,
    profile.country,
    profile.organization,
    profile.organizationalUnit,
  )
  const certificate = await x509.X509CertificateGenerator.create({
    publicKey: subjectKey.publicKey,
    signingKey: issuer.key.privateKey,
    subject,
    issuer: issuer.certificate.subjectName,
    serialNumber: bytesToHex(profile.serial ?? randomSerial()),
    notBefore: profile.notBefore,
    notAfter: profile.notAfter,
    signingAlgorithm: certificateSigningAlgorithm(issuer.key, hash),
    extensions,
  })
  return describeCertificate(certificate)
}

/**
 * Creates a CSCA Link certificate for key rollover (Doc 9303-12 §7.1.1):
 * `issuer` is the old CSCA DN, `subject` the new CSCA DN, signed by the old key,
 * certifying the new public key.  A NameChange extension is included when the
 * subject name differs.
 */
export async function createCscaLink(
  oldCertificate: x509.X509Certificate,
  oldKey: CertKeyPair,
  newProfile: CscaProfile,
  newPublicKey: CryptoKey,
  newKeyPss: boolean,
  options: { hash?: HashName; serial?: Uint8Array } = {},
): Promise<GeneratedCertificate> {
  void newKeyPss
  const hash = options.hash ?? 'SHA-256'
  const nameChanged =
    oldCertificate.subjectName.getField('CN')[0] !== newProfile.commonName ||
    oldCertificate.subjectName.getField('C')[0] !== (newProfile.country ?? 'XD') ||
    oldCertificate.subjectName.getField('O')[0] !== newProfile.organization ||
    oldCertificate.subjectName.getField('OU')[0] !== newProfile.organizationalUnit
  const extensions = [
    await subjectKeyIdentifier(newPublicKey),
    await authorityKeyIdentifier(oldKey.publicKey),
    ...(nameChanged
      ? [
          nameChangeExtension(
            simpleNameValue(
              '',
              newProfile.country ?? 'XD',
              newProfile.organization,
              newProfile.organizationalUnit,
            ),
            simpleNameValue(
              newProfile.commonName,
              newProfile.country,
              newProfile.organization,
              newProfile.organizationalUnit,
            ),
          ),
        ]
      : []),
    keyUsage(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign),
    privateKeyUsagePeriod(
      newProfile.notBefore,
      newProfile.privateKeyNotAfter ?? newProfile.notAfter,
    ),
    basicConstraints(true, 0),
    cscaSubjectAltName(newProfile.locality, newProfile.state),
    cscaIssuerAltName(newProfile.locality, newProfile.state),
    crlDistributionPoints(newProfile.crlDistributionPoints),
  ]
  const certificate = await x509.X509CertificateGenerator.create({
    publicKey: newPublicKey,
    signingKey: oldKey.privateKey,
    subject: nameOf(
      newProfile.commonName,
      newProfile.country,
      newProfile.organization,
      newProfile.organizationalUnit,
    ),
    issuer: oldCertificate.subjectName,
    serialNumber: bytesToHex(options.serial ?? randomSerial()),
    notBefore: newProfile.notBefore,
    notAfter: newProfile.notAfter,
    signingAlgorithm: certificateSigningAlgorithm(oldKey, hash),
    extensions,
  })
  return describeCertificate(certificate)
}

/** Creates a Master List Signer certificate (EKU id-icao-cscaMasterListSigningKey). */
export async function createMasterListSigner(
  profile: MasterListSignerProfile,
  subjectKey: CertKeyPair,
  issuer: { certificate: x509.X509Certificate; key: CertKeyPair; hash?: HashName },
): Promise<GeneratedCertificate> {
  const hash = issuer.hash ?? profile.hash ?? 'SHA-256'
  const extensions = [
    await authorityKeyIdentifier(issuer.key.publicKey),
    await subjectKeyIdentifier(subjectKey.publicKey),
    keyUsage(x509.KeyUsageFlags.digitalSignature),
    extendedKeyUsage([OIDS.idIcaoCscaMasterListSigningKey]),
  ]
  const certificate = await x509.X509CertificateGenerator.create({
    publicKey: subjectKey.publicKey,
    signingKey: issuer.key.privateKey,
    subject: nameOf(
      profile.commonName,
      profile.country,
      profile.organization,
      profile.organizationalUnit,
    ),
    issuer: issuer.certificate.subjectName,
    serialNumber: bytesToHex(profile.serial ?? randomSerial()),
    notBefore: profile.notBefore,
    notAfter: profile.notAfter,
    signingAlgorithm: certificateSigningAlgorithm(issuer.key, hash),
    extensions,
  })
  return describeCertificate(certificate)
}

/** Parses a DER/PEM certificate into an `X509Certificate`. */
export function parseCertificate(der: Uint8Array): x509.X509Certificate {
  return new x509.X509Certificate(toArrayBuffer(der))
}

/** Parses a certificate from PEM text. */
export function parseCertificatePem(pem: string): x509.X509Certificate {
  return new x509.X509Certificate(pem)
}
