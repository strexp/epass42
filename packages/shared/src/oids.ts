/**
 * Object identifiers used across the PKI, copied from Appendix A of TODO.md.
 *
 * Names follow RFC/ICAO conventions so that the values can be traced back to a
 * specification.
 */
export const OIDS = {
  // ICAO Doc 9303 arcs.
  /** LDS Security Object (EF.SOD eContent). */
  ldsSecurityObject: '2.23.136.1.1.1',
  /** CSCA Master List. */
  idIcaoCscaMasterList: '2.23.136.1.1.2',
  /** Master List Signer EKU. */
  idIcaoCscaMasterListSigningKey: '2.23.136.1.1.3',
  /** NameChange extension (CSCA link certificates). */
  idIcaoNameChange: '2.23.136.1.1.6.1',
  /** DocumentType extension. */
  idIcaoDocumentType: '2.23.136.1.1.6.2',

  // Authorization PKI (Doc 9303-12 §7.2), BSI TR-03110.
  /** Certificate Holder Authorization Template OID arc. */
  idChat: '0.4.0.127.0.7.3.1.1',
  /** `id-IS` CHAT template OID for the passport profile (BSI TR-03110-4 §2.1.3.2). */
  idIsChat: '0.4.0.127.0.7.3.1.2.1',
  /** Terminal types: Inspection System / Authentication / Signature. */
  idIs: '0.4.0.127.0.7.3.1.2',
  idAt: '0.4.0.127.0.7.3.1.3',
  idSt: '0.4.0.127.0.7.3.1.4',
  /** `id-TA` terminal-authentication protocol arc (Doc 9303-11 §9.2.8). */
  idTa: '0.4.0.127.0.7.2.2.2',
  /** `id-TA-ECDSA-SHA-256` CV public key / signature (BSI TR-03110-3 Table 27). */
  idTaEcdsaSha256: '0.4.0.127.0.7.2.2.2.2.3',
  /** `id-TA-RSA-PSS-SHA-256` CV public key / signature. */
  idTaRsaPssSha256: '0.4.0.127.0.7.2.2.2.1.4',
  /** DH / ECDH public key OIDs (Chip Authentication public key info). */
  idPkDh: '0.4.0.127.0.7.2.2.1.1',
  idPkEcdh: '0.4.0.127.0.7.2.2.1.2',
  /** LDS2 application authorization extensions (Doc 9303-10 Table 99). */
  lds2TravelAuth: '2.23.136.1.1.9.1.3',
  lds2VisaAuth: '2.23.136.1.1.9.2.3',
  lds2BiometricsAuth: '2.23.136.1.1.9.3.3',
  /** LDS2 Signer EKU arc (`id-icao-lds2Signer`, Doc 9303-12 §7.1.2 Table 7). */
  lds2Signer: '2.23.136.1.1.9.8',
  /** LDS2 Travel Stamp Signer EKU (`id-icao-tsSigner`). */
  lds2TsSigner: '2.23.136.1.1.9.8.1',
  /** LDS2 Electronic Visa Signer EKU (`id-icao-vSigner`). */
  lds2VisaSigner: '2.23.136.1.1.9.8.2',
  /** LDS2 Additional Biometrics Signer EKU (`id-icao-bSigner`). */
  lds2BiometricsSigner: '2.23.136.1.1.9.8.3',

  // EF.CardSecurity eContent (id-SecurityObject, BSI TR-03110).
  securityObject: '0.4.0.127.0.7.3.2.1',

  // RFC 5652 CMS.
  cmsSignedData: '1.2.840.113549.1.7.2',
  cmsContentType: '1.2.840.113549.1.9.3',
  cmsMessageDigest: '1.2.840.113549.1.9.4',
  cmsSigningTime: '1.2.840.113549.1.9.5',

  // RFC 5280 X.509 extensions.
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  privateKeyUsagePeriod: '2.5.29.16',
  subjectAltName: '2.5.29.17',
  issuerAltName: '2.5.29.18',
  basicConstraints: '2.5.29.19',
  cRLNumber: '2.5.29.20',
  cRLDistributionPoints: '2.5.29.31',
  authorityKeyIdentifier: '2.5.29.35',
  extKeyUsage: '2.5.29.37',

  // Signature / digest algorithms.
  sha1: '1.3.14.3.2.26',
  sha224: '2.16.840.1.101.3.4.2.4',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
} as const

/**
 * The three LDS2 signer roles a CSCA may authorize (Doc 9303-12 §7.1.2):
 * Travel Stamp (`ts`), Electronic Visa (`v`) and Additional Biometrics (`b`).
 * One certificate may carry several of them in its ExtendedKeyUsage.
 */
export const LDS2_SIGNER_TYPES = ['ts', 'v', 'b'] as const
export type Lds2SignerType = (typeof LDS2_SIGNER_TYPES)[number]

/** The certificate types the CSCA issues: Document Signer or LDS2 Signer. */
export const SIGNER_CERTIFICATE_TYPES = ['dsc', 'lds2'] as const
export type SignerCertificateType = (typeof SIGNER_CERTIFICATE_TYPES)[number]

/** Maps an LDS2 signer role to its ExtendedKeyUsage OID. */
export const LDS2_SIGNER_OIDS: Record<Lds2SignerType, string> = {
  ts: OIDS.lds2TsSigner,
  v: OIDS.lds2VisaSigner,
  b: OIDS.lds2BiometricsSigner,
}

/** The signer roles authorized by a list of ExtendedKeyUsage OIDs. */
export function lds2SignerTypesFromOids(oids: readonly string[]): Lds2SignerType[] {
  return LDS2_SIGNER_TYPES.filter((type) => oids.includes(LDS2_SIGNER_OIDS[type]))
}
