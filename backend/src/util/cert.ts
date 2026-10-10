/**
 * Certificate field helpers shared by the CSCA and PKD surfaces.
 */
import { OIDS } from '@epass42/shared'
import { parseCertificatePem, parseTlv } from '@epass42/pki'

/**
 * The ICAO DocumentType values encoded in a DSC certificate's DocumentType
 * extension (Doc 9303-12 §7.1.1 Table 6), e.g. `['P']` for passports.  Returns
 * an empty list when the extension is absent or malformed.
 */
export function documentTypesOf(certPem: string): string[] {
  try {
    const cert = parseCertificatePem(certPem)
    const extension = cert.getExtension(OIDS.idIcaoDocumentType)
    if (!extension) return []
    const node = parseTlv(new Uint8Array(extension.value))
    const set = node.children.find((child) => child.tag === 0x31)
    if (!set) return []
    return set.children
      .filter((child) => child.tag === 0x13 || child.tag === 0x0c)
      .map((child) => Buffer.from(child.value).toString('latin1'))
  } catch {
    return []
  }
}
