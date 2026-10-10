/**
 * LDIF serialization of the PKD directory (M9/T9.3).
 *
 * Certificates use `inetOrgPerson` + `userCertificate;binary`, CRLs use
 * `cRLDistributionPoint` + `certificateRevocationList;binary`, and Master Lists
 * use the ICAO objectClass `2.23.136.2` with the attribute `2.23.136.1.1.2`
 * (see `deploy/openldap/epass42.schema`).
 */
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { baseDn, listObjects, suffixEntry, type PkdObject } from './directory'

/** Encodes bytes as an LDIF `::` base64 value. */
function base64Value(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** Wraps long base64 lines at 76 characters (as required by RFC 2849). */
function wrap(value: string): string[] {
  const lines: string[] = []
  for (let i = 0; i < value.length; i += 72) lines.push(value.slice(i, i + 72))
  return lines
}

/** Renders one object entry. */
function entryFor(config: AppConfig, object: PkdObject): string {
  const base = baseDn(config)
  const lines: string[] = []
  if (object.kind === 'csca') {
    lines.push(`dn: cn=${object.cn},ou=csca,${base}`)
    lines.push(
      'objectClass: top',
      'objectClass: person',
      'objectClass: organizationalPerson',
      'objectClass: inetOrgPerson',
    )
    lines.push(`cn: ${object.cn}`, `sn: ${object.cn}`)
    if (object.subject) lines.push(`description: ${object.subject}`)
    lines.push(`userCertificate;binary:: ${wrap(base64Value(object.der)).join('\n ')}`)
  } else if (object.kind === 'crl') {
    lines.push(`dn: cn=${object.cn},ou=crl,${base}`)
    lines.push('objectClass: top', 'objectClass: cRLDistributionPoint')
    lines.push(`cn: ${object.cn}`)
    lines.push(`certificateRevocationList;binary:: ${wrap(base64Value(object.der)).join('\n ')}`)
  } else {
    lines.push(`dn: cn=${object.cn},ou=masterlist,${base}`)
    lines.push('objectClass: top', 'objectClass: person', 'objectClass: 2.23.136.2')
    lines.push(`cn: ${object.cn}`, `sn: ${object.cn}`)
    lines.push(`2.23.136.1.1.2:: ${wrap(base64Value(object.der)).join('\n ')}`)
  }
  return lines.join('\n')
}

/** Renders the full directory as LDIF (suitable for `slapadd`). */
export function buildLdif(db: Db, config: AppConfig): string {
  const base = baseDn(config)
  const suffix = suffixEntry(config)
  const header = [
    `dn: ${suffix.dn}`,
    'objectClass: top',
    `objectClass: ${suffix.objectClass}`,
    `${suffix.attribute}: ${suffix.value}`,
    '',
    `dn: ou=csca,${base}`,
    'objectClass: top',
    'objectClass: organizationalUnit',
    'ou: csca',
    '',
    `dn: ou=crl,${base}`,
    'objectClass: top',
    'objectClass: organizationalUnit',
    'ou: crl',
    '',
    `dn: ou=masterlist,${base}`,
    'objectClass: top',
    'objectClass: organizationalUnit',
    'ou: masterlist',
    '',
  ]
  const entries = listObjects(db, config).map(entryFor.bind(null, config))
  return [...header, ...entries, ''].join('\n')
}
