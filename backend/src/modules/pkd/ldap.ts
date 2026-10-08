/**
 * Read-only LDAP compatibility layer (M9/T9.4).
 *
 * Exposes the same DIT as the REST/LDIF surfaces using `ldapjs`: only Bind and
 * Search are implemented, no write operations.  Started by the entrypoint when
 * `LDAP_ENABLED=true`; tests start it on an ephemeral port.
 */
import ldapjs from 'ldapjs'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { baseDn, listObjects, type PkdObject } from './directory'

/** An LDAP entry with a plain attribute map (values lowercased keys). */
export interface LdapEntry {
  dn: string
  attributes: Record<string, string[] | Buffer[]>
}

/** Builds the LDAP DIT from the published objects. */
export function buildEntries(db: Db, config: AppConfig): LdapEntry[] {
  const base = baseDn(config)
  const entries: LdapEntry[] = [
    { dn: base, attributes: { objectclass: ['top', 'organization'], o: ['ePass 42'] } },
    {
      dn: `ou=csca,${base}`,
      attributes: { objectclass: ['top', 'organizationalUnit'], ou: ['csca'] },
    },
    {
      dn: `ou=crl,${base}`,
      attributes: { objectclass: ['top', 'organizationalUnit'], ou: ['crl'] },
    },
    {
      dn: `ou=masterlist,${base}`,
      attributes: { objectclass: ['top', 'organizationalUnit'], ou: ['masterlist'] },
    },
  ]
  for (const object of listObjects(db, config)) {
    entries.push(entryFor(base, object))
  }
  return entries
}

function entryFor(base: string, object: PkdObject): LdapEntry {
  if (object.kind === 'csca') {
    return {
      dn: `cn=${object.cn},ou=csca,${base}`,
      attributes: {
        objectclass: ['top', 'person', 'organizationalPerson', 'inetOrgPerson'],
        cn: [object.cn],
        sn: [object.cn],
        'usercertificate;binary': [Buffer.from(object.der)],
      },
    }
  }
  if (object.kind === 'crl') {
    return {
      dn: `cn=${object.cn},ou=crl,${base}`,
      attributes: {
        objectclass: ['top', 'cRLDistributionPoint'],
        cn: [object.cn],
        'certificaterevocationlist;binary': [Buffer.from(object.der)],
      },
    }
  }
  return {
    dn: `cn=${object.cn},ou=masterlist,${base}`,
    attributes: {
      objectclass: ['top', 'person', '2.23.136.2'],
      cn: [object.cn],
      sn: [object.cn],
      '2.23.136.1.1.2': [Buffer.from(object.der)],
    },
  }
}

/** Evaluates an ldapjs filter against an entry attribute map. */
export function matchesFilter(
  filter: unknown,
  attributes: Record<string, string[] | Buffer[]>,
): boolean {
  const node = filter as {
    type?: string
    attribute?: string
    value?: unknown
    initial?: string
    any?: string[]
    final?: string
    filters?: unknown[]
    filter?: unknown
  }
  const lookup = (attribute?: string): string[] => {
    if (!attribute) return []
    const values = attributes[attribute.toLowerCase()]
    if (!values) return []
    return values.map((value) =>
      Buffer.isBuffer(value) ? value.toString('base64') : String(value),
    )
  }
  switch (node.type) {
    case 'equal':
    case 'EqualityFilter': {
      const expected = normalize(node.value)
      return lookup(node.attribute).some((value) => value.toLowerCase() === expected)
    }
    case 'present':
    case 'PresenceFilter':
      return lookup(node.attribute).length > 0
    case 'substr':
    case 'substring':
    case 'SubstringFilter': {
      return lookup(node.attribute).some((value) => {
        const lower = value.toLowerCase()
        if (node.initial && !lower.startsWith(node.initial.toLowerCase())) return false
        if (node.final && !lower.endsWith(node.final.toLowerCase())) return false
        for (const part of node.any ?? []) {
          if (!lower.includes(part.toLowerCase())) return false
        }
        return true
      })
    }
    case 'and':
    case 'AndFilter':
      return (node.filters ?? []).every((child) => matchesFilter(child, attributes))
    case 'or':
    case 'OrFilter':
      return (node.filters ?? []).some((child) => matchesFilter(child, attributes))
    case 'not':
    case 'NotFilter':
      return !matchesFilter(node.filter, attributes)
    default:
      return false
  }
}

function normalize(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('base64').toLowerCase()
  return String(value).toLowerCase()
}

/** Scope-based DN matching. */
function inScope(entryDn: string, base: string, scope: string): boolean {
  const entry = entryDn.toLowerCase()
  const target = base.toLowerCase()
  if (scope === 'base') return entry === target
  if (scope === 'one')
    return entry.endsWith(`,${target}`) && entry.slice(0, -(target.length + 1)).indexOf(',') === -1
  return entry === target || entry.endsWith(`,${target}`)
}

/** A running read-only LDAP server. */
export interface LdapServerHandle {
  port: number
  close(): Promise<void>
}

/** Starts the read-only LDAP server. */
export function startLdapServer(
  deps: { db: Db; config: AppConfig; log?: (message: string) => void },
  port = deps.config.ldap.port,
): Promise<LdapServerHandle> {
  const server = ldapjs.createServer()

  server.bind(baseDn(deps.config), (_req: unknown, res: { end(): void }) => {
    // Simple/anonymous bind only; credentials are not validated read-only.
    res.end()
  })

  server.search(
    baseDn(deps.config),
    (
      req: { dn?: { toString(): string }; scope?: string; filter?: unknown },
      res: { send(entry: unknown): void; end(): void },
    ) => {
      const base = req.dn?.toString() ?? baseDn(deps.config)
      const scope = req.scope ?? 'sub'
      for (const entry of buildEntries(deps.db, deps.config)) {
        if (!inScope(entry.dn, base, scope)) continue
        if (!matchesFilter(req.filter, entry.attributes)) continue
        res.send({ dn: entry.dn, attributes: entry.attributes })
      }
      res.end()
    },
  )

  return new Promise((resolve, reject) => {
    server.listen(port, deps.config.ldap.host, () => {
      const address = (
        server as unknown as { address(): { port: number } | string | null }
      ).address()
      const actual = typeof address === 'object' && address ? address.port : port
      deps.log?.(`read-only LDAP listening on ${deps.config.ldap.host}:${actual}`)
      resolve({
        port: actual,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          }),
      })
    })
    server.on('error', reject)
  })
}
