/**
 * IP → maintainer (MNT) resolution via dn42 whois (M7 jurisdiction).
 *
 * Given a client IP the resolver queries the configured whois server and
 * extracts the `mnt-by` maintainer(s) of the matching `route`/`route6` object.
 * An empty result means the IP could not be attributed.
 */
import { createConnection } from 'node:net'

/** The whois connection settings. */
export interface WhoisConfig {
  whois: string
  whoisPort: number
  whoisTimeoutMs: number
}

/** Resolves the maintainer(s) owning an IP address. */
export interface MntResolver {
  resolve(ip: string): Promise<string[]>
}

/** How long a resolved IP→MNT answer is cached. */
const CACHE_TTL_MS = 5 * 60_000

/** Extracts the `mnt-by` values from a whois response (pure, testable). */
export function parseMntBy(text: string): string[] {
  const mnts = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*mnt-by:\s*(.+?)\s*$/i.exec(line)
    if (!match) continue
    for (const value of match[1]!.split(/[,\s]+/)) {
      const mnt = value.trim().toUpperCase()
      if (mnt !== '') mnts.add(mnt)
    }
  }
  return [...mnts]
}

/** Sorts, dedupes and joins maintainers into a canonical stored value. */
export function canonicalMnts(mnts: string[]): string | null {
  const unique = [...new Set(mnts.map((mnt) => mnt.trim().toUpperCase()).filter(Boolean))].sort()
  return unique.length > 0 ? unique.join(',') : null
}

/** True when a stored (canonical) maintainer value contains `mnt`. */
export function mntIncludes(stored: string | null, mnt: string | null): boolean {
  if (!stored || !mnt) return false
  return stored.split(',').includes(mnt)
}

/** Runs a single whois query over TCP. */
function whoisQuery(config: WhoisConfig, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.whois, port: config.whoisPort })
    let data = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(data)
    }
    socket.setTimeout(config.whoisTimeoutMs, () => finish(new Error('whois query timed out')))
    socket.on('connect', () => socket.write(`${query}\r\n`))
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
    })
    socket.on('end', () => finish())
    socket.on('error', (error: Error) => finish(error))
  })
}

/** whois-backed {@link MntResolver} with a short-lived cache. */
export class WhoisMntResolver implements MntResolver {
  private readonly cache = new Map<string, { mnts: string[]; expires: number }>()

  constructor(private readonly config: WhoisConfig) {}

  async resolve(ip: string): Promise<string[]> {
    const key = ip.replace(/^::ffff:/, '')
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.mnts
    const text = await whoisQuery(this.config, key)
    const mnts = parseMntBy(text)
    this.cache.set(key, { mnts, expires: Date.now() + CACHE_TTL_MS })
    return mnts
  }
}
