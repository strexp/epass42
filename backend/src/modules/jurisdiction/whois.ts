/**
 * IP → maintainer (MNT) resolution via dn42 whois (M7): queries the configured
 * server and extracts the `route`/`route6` `mnt-by` values.  Answers are cached
 * (bounded TTL/LRU), concurrent lookups share one socket, and each query has a
 * total timeout and a response-size cap.
 */
import { createConnection } from 'node:net'

/** The whois connection and cache settings. */
export interface WhoisConfig {
  whois: string
  whoisPort: number
  whoisTimeoutMs: number
  /** How long a resolved answer is cached; defaults to {@link WHOIS_CACHE_TTL_MS}. */
  whoisCacheTtlMs?: number
  /** Maximum cached answers; defaults to {@link WHOIS_CACHE_MAX_ENTRIES}. */
  whoisCacheMaxEntries?: number
}

/** Resolves the maintainer(s) owning an IP address. */
export interface MntResolver {
  resolve(ip: string): Promise<string[]>
}

/** Default cache lifetime: 5 minutes (dn42 route objects change rarely). */
export const WHOIS_CACHE_TTL_MS = 5 * 60_000

/** Default cache size bound, so many distinct IPs cannot exhaust memory. */
export const WHOIS_CACHE_MAX_ENTRIES = 1024

/** Hard cap on a whois response, so a misbehaving server cannot exhaust memory. */
const MAX_RESPONSE_BYTES = 1 << 20

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

/** Runs a single whois query over TCP, bounded by a total timeout. */
export function whoisQuery(config: WhoisConfig, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.whois, port: config.whoisPort })
    let data = ''
    let bytes = 0
    let settled = false
    const state: { deadline?: ReturnType<typeof setTimeout> } = {}
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (state.deadline) clearTimeout(state.deadline)
      socket.destroy()
      if (error) reject(error)
      else resolve(data)
    }
    // A total deadline (not reset by incoming data) as well as an idle timeout.
    state.deadline = setTimeout(
      () => finish(new Error('whois query timed out')),
      config.whoisTimeoutMs,
    )
    socket.setTimeout(config.whoisTimeoutMs, () => finish(new Error('whois query timed out')))
    socket.on('connect', () => socket.write(`${query}\r\n`))
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_RESPONSE_BYTES) {
        finish(new Error('whois response too large'))
        return
      }
      data += chunk.toString('utf8')
    })
    socket.on('end', () => finish())
    socket.on('error', (error: Error) => finish(error))
  })
}

/** A whois query function (injectable so tests need no network). */
export type WhoisQuery = (config: WhoisConfig, query: string) => Promise<string>

/**
 * whois-backed {@link MntResolver} with a bounded TTL/LRU cache.
 *
 * Answers (including negative ones) are cached for `whoisCacheTtlMs`; at most
 * `whoisCacheMaxEntries` are kept, evicting the least recently used.  Failures
 * are not cached, so a transient whois outage is retried on the next request.
 */
export class WhoisMntResolver implements MntResolver {
  private readonly cache = new Map<string, { mnts: string[]; expires: number }>()
  private readonly pending = new Map<string, Promise<string[]>>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(
    private readonly config: WhoisConfig,
    private readonly query: WhoisQuery = whoisQuery,
  ) {
    this.ttlMs = config.whoisCacheTtlMs ?? WHOIS_CACHE_TTL_MS
    this.maxEntries = Math.max(1, config.whoisCacheMaxEntries ?? WHOIS_CACHE_MAX_ENTRIES)
  }

  async resolve(ip: string): Promise<string[]> {
    const key = ip.replace(/^::ffff:/, '')
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) {
      // Refresh the LRU position.
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached.mnts
    }
    if (cached) this.cache.delete(key)

    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const lookup = this.lookup(key).finally(() => this.pending.delete(key))
    this.pending.set(key, lookup)
    return lookup
  }

  private async lookup(key: string): Promise<string[]> {
    const text = await this.query(this.config, key)
    const mnts = parseMntBy(text)
    this.store(key, mnts)
    return mnts
  }

  private store(key: string, mnts: string[]): void {
    this.cache.delete(key)
    this.cache.set(key, { mnts, expires: Date.now() + this.ttlMs })
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }
}
