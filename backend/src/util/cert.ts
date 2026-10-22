/**
 * Certificate field helpers shared by the CSCA and PKD surfaces.
 */
import { documentTypesOfCertificate, parseCertificatePem } from '@epass42/pki'

/**
 * The ICAO DocumentType values encoded in a DSC certificate's DocumentType
 * extension (Doc 9303-12 §7.1.1 Table 6), e.g. `['P', 'I']`.  Returns an empty
 * list when the extension is absent or malformed.
 */
export function documentTypesOf(certPem: string): string[] {
  try {
    return documentTypesOfCertificate(parseCertificatePem(certPem))
  } catch {
    return []
  }
}
