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
