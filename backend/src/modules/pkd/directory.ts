/**
 * PKD directory aggregation (M9/T9.1).
 *
 * Publishes the CSCA certificates (root and link), CRLs and Master Lists, and
 * the authorization-PKI CVCA and DV certificates (Doc 9303-12 §7.2), as opaque
 * DER objects with stable ids, plus the LDAP DN layout used by the REST, LDIF
 * and read-only LDAP surfaces.
 */
import { parseCertificatePem } from '@epass42/pki'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { crl, cscaKey, cvcaKey, dscCert, dvCert, masterList } from '../../db/schema'

/** The kinds of published object. */
export type PkdObjectKind = 'csca' | 'crl' | 'ml' | 'cvca' | 'dv' | 'dsc'

/** A published object. */
export interface PkdObject {
  id: string
  kind: PkdObjectKind
  /** DER bytes. */
  der: Uint8Array
  cn: string
  subject?: string
  status?: string
  /** The CSCA key that issued this object (certificate or CRL). */
  cscaKeyId?: number
  cscaSerial?: string
  cscaSubject?: string
  /** CRL validity window. */
  thisUpdate?: string
  nextUpdate?: string
}

/** The directory base DN. */
export function baseDn(config: AppConfig): string {
  return config.pkd.baseDn ?? `c=${config.countryAlpha2},dc=data,dc=download,dc=pkd,dc=icao,dc=int`
}

/** The suffix (naming) entry derived from the base DN. */
export interface SuffixEntry {
  dn: string
  /** Naming attribute of the first RDN (e.g. `c`, `dc`, `o`, `ou`). */
  attribute: string
  value: string
  /** Structural object class whose naming attribute matches. */
  objectClass: string
}

/**
 * Derives a valid suffix entry from the base DN so the naming attribute of the
 * first RDN is present with a matching object class (required by LDAP).
 */
export function suffixEntry(config: AppConfig): SuffixEntry {
  const dn = baseDn(config)
  const rdn = dn.split(',')[0] ?? ''
  const eq = rdn.indexOf('=')
  const attribute = (eq === -1 ? 'o' : rdn.slice(0, eq)).trim()
  const value = (eq === -1 ? '' : rdn.slice(eq + 1)).trim().replace(/\\(.)/g, '$1')
  const lower = attribute.toLowerCase()
  const objectClass =
    lower === 'c'
      ? 'country'
      : lower === 'dc'
        ? 'domain'
        : lower === 'ou'
          ? 'organizationalUnit'
          : 'organization'
  return { dn, attribute, value, objectClass }
}

/** Lists every published object. */
export function listObjects(db: Db, config: AppConfig): PkdObject[] {
  void config
  const objects: PkdObject[] = []
  const cscaRows = db.select().from(cscaKey).all()
  const cscaById = new Map(cscaRows.map((row) => [row.id, row]))
  for (const row of cscaRows) {
    objects.push({
      id: `csca-${row.id}`,
      kind: 'csca',
      cn: row.serial,
      subject: row.subjectDn,
      status: row.status,
      cscaKeyId: row.id,
      cscaSerial: row.serial,
      cscaSubject: row.subjectDn,
      der: new Uint8Array(parseCertificatePem(row.certPem).rawData),
    })
  }
  for (const row of db.select().from(dscCert).all()) {
    if (row.source !== 'nia' && row.source !== 'owned') continue
    objects.push({
      id: `dsc-${row.id}`,
      kind: 'dsc',
      cn: row.serial,
      subject: row.subjectDn,
      status: row.status,
      cscaKeyId: row.cscaKeyId ?? undefined,
      cscaSerial: row.cscaKeyId !== null ? cscaById.get(row.cscaKeyId)?.serial : undefined,
      der: new Uint8Array(parseCertificatePem(row.certPem).rawData),
    })
  }
  for (const row of db.select().from(crl).all()) {
    const issuer = row.cscaKeyId !== null ? cscaById.get(row.cscaKeyId) : undefined
    objects.push({
      id: `crl-${row.id}`,
      kind: 'crl',
      cn: String(row.crlNumber),
      cscaKeyId: row.cscaKeyId ?? undefined,
      cscaSerial: issuer?.serial,
      cscaSubject: issuer?.subjectDn,
      thisUpdate: row.thisUpdate,
      nextUpdate: row.nextUpdate,
      der: new Uint8Array(row.der),
    })
  }
  for (const row of db.select().from(masterList).all()) {
    objects.push({
      id: `ml-${row.id}`,
      kind: 'ml',
      cn: String(row.id),
      der: new Uint8Array(row.der),
    })
  }
  for (const row of db.select().from(cvcaKey).all()) {
    objects.push({
      id: `cvca-${row.id}`,
      kind: 'cvca',
      cn: compactReference(row.holderReference),
      subject: row.subjectCn ?? row.holderReference,
      status: row.status,
      der: new Uint8Array(row.certDer),
    })
  }
  for (const row of db.select().from(dvCert).all()) {
    objects.push({
      id: `dv-${row.id}`,
      kind: 'dv',
      cn: compactReference(row.holderReference),
      subject: row.subjectCn ?? row.holderReference,
      status: row.status,
      der: new Uint8Array(row.certDer),
    })
  }
  return objects
}

/**
 * Renders a Certificate Holder Reference as a DN-safe value (no padding
 * spaces), used for the LDAP `cn` of a CVCA/DV entry.
 */
export function compactReference(reference: string): string {
  return reference.replace(/\s+/g, '')
}
