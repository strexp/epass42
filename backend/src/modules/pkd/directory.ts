/**
 * PKD directory aggregation (M9/T9.1).
 *
 * Publishes the CSCA certificates (root and link), CRLs and Master Lists as
 * opaque DER objects with stable ids, plus the LDAP DN layout used by the REST,
 * LDIF and read-only LDAP surfaces.
 */
import { parseCertificatePem } from '@epass42/pki'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { crl, cscaKey, masterList } from '../../db/schema'

/** The kinds of published object. */
export type PkdObjectKind = 'csca' | 'crl' | 'ml'

/** A published object. */
export interface PkdObject {
  id: string
  kind: PkdObjectKind
  /** DER bytes. */
  der: Uint8Array
  cn: string
  subject?: string
  status?: string
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
  for (const row of db.select().from(cscaKey).all()) {
    objects.push({
      id: `csca-${row.id}`,
      kind: 'csca',
      cn: row.serial,
      subject: row.subjectDn,
      status: row.status,
      der: new Uint8Array(parseCertificatePem(row.certPem).rawData),
    })
  }
  for (const row of db.select().from(crl).all()) {
    objects.push({
      id: `crl-${row.id}`,
      kind: 'crl',
      cn: String(row.crlNumber),
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
  return objects
}
