import { createServer, type AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import {
  canonicalMnts,
  mntIncludes,
  parseMntBy,
  WhoisMntResolver,
  type WhoisConfig,
  type WhoisQuery,
} from './whois'

const ROUTE_OBJECT = `% Information related to '172.20.0.0/16AS4242420001'

route:          172.20.0.0/16
origin:         AS4242420001
mnt-by:         EXAMPLE-MNT
mnt-by:         OTHER-MNT
source:         DN42
`

const CONFIG: WhoisConfig = { whois: 'whois.test', whoisPort: 43, whoisTimeoutMs: 5000 }

/** A query stub that counts calls and returns a fixed answer after a delay. */
function countingQuery(text: string, delayMs = 0): { calls: () => number; query: WhoisQuery } {
  let calls = 0
  const query: WhoisQuery = async () => {
    calls += 1
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return text
  }
  return { calls: () => calls, query }
}

describe('whois mnt-by parsing', () => {
  it('extracts every mnt-by value', () => {
    expect(parseMntBy(ROUTE_OBJECT)).toEqual(['EXAMPLE-MNT', 'OTHER-MNT'])
  })

  it('splits comma-or-space separated maintainers and dedupes', () => {
    expect(parseMntBy('mnt-by: A, B\nmnt-by: a\n')).toEqual(['A', 'B'])
  })

  it('returns an empty list when the object has no maintainer', () => {
    expect(parseMntBy('% No entries found')).toEqual([])
  })

  it('canonicalizes a maintainer set deterministically', () => {
    expect(canonicalMnts(['b-mnt', 'A-MNT', 'b-mnt'])).toBe('A-MNT,B-MNT')
    expect(canonicalMnts([])).toBeNull()
  })

  it('matches any member of a canonical set', () => {
    expect(mntIncludes('A-MNT,B-MNT', 'B-MNT')).toBe(true)
    expect(mntIncludes('A-MNT,B-MNT', 'C-MNT')).toBe(false)
    expect(mntIncludes(null, 'A-MNT')).toBe(false)
  })
})

describe('whois resolver cache', () => {
  it('caches answers and coalesces concurrent lookups into one query', async () => {
    const stub = countingQuery(ROUTE_OBJECT, 20)
    const resolver = new WhoisMntResolver(CONFIG, stub.query)

    const [first, second] = await Promise.all([
      resolver.resolve('172.20.0.1'),
      resolver.resolve('172.20.0.1'),
    ])
    expect(first).toEqual(['EXAMPLE-MNT', 'OTHER-MNT'])
    expect(second).toEqual(['EXAMPLE-MNT', 'OTHER-MNT'])
    expect(stub.calls()).toBe(1)

    await resolver.resolve('172.20.0.1')
    expect(stub.calls()).toBe(1)
  })

  it('treats an IPv4-mapped IPv6 address as the same key', async () => {
    const stub = countingQuery(ROUTE_OBJECT)
    const resolver = new WhoisMntResolver(CONFIG, stub.query)

    await resolver.resolve('::ffff:172.20.0.1')
    await resolver.resolve('172.20.0.1')
    expect(stub.calls()).toBe(1)
  })

  it('caches negative answers ("no maintainer")', async () => {
    const stub = countingQuery('% No entries found')
    const resolver = new WhoisMntResolver(CONFIG, stub.query)

    expect(await resolver.resolve('172.20.0.1')).toEqual([])
    expect(await resolver.resolve('172.20.0.1')).toEqual([])
    expect(stub.calls()).toBe(1)
  })

  it('does not cache failures', async () => {
    let calls = 0
    const query: WhoisQuery = async () => {
      calls += 1
      if (calls === 1) throw new Error('whois query timed out')
      return ROUTE_OBJECT
    }
    const resolver = new WhoisMntResolver(CONFIG, query)

    await expect(resolver.resolve('172.20.0.1')).rejects.toThrow('timed out')
    expect(await resolver.resolve('172.20.0.1')).toEqual(['EXAMPLE-MNT', 'OTHER-MNT'])
    expect(calls).toBe(2)
  })

  it('expires entries after the TTL', async () => {
    const stub = countingQuery(ROUTE_OBJECT)
    const resolver = new WhoisMntResolver({ ...CONFIG, whoisCacheTtlMs: 40 }, stub.query)

    await resolver.resolve('172.20.0.1')
    await new Promise((resolve) => setTimeout(resolve, 60))
    await resolver.resolve('172.20.0.1')
    expect(stub.calls()).toBe(2)
  })

  it('evicts the least recently used entry beyond the bound', async () => {
    const stub = countingQuery(ROUTE_OBJECT)
    const resolver = new WhoisMntResolver({ ...CONFIG, whoisCacheMaxEntries: 2 }, stub.query)

    await resolver.resolve('10.0.0.1')
    await resolver.resolve('10.0.0.2')
    await resolver.resolve('10.0.0.1') // refresh 10.0.0.1
    await resolver.resolve('10.0.0.3') // evicts 10.0.0.2
    expect(stub.calls()).toBe(3)

    await resolver.resolve('10.0.0.1') // still cached
    expect(stub.calls()).toBe(3)
    await resolver.resolve('10.0.0.2') // was evicted
    expect(stub.calls()).toBe(4)
  })
})

describe('whois query timeout', () => {
  it('rejects when the server accepts but never answers', async () => {
    const sockets: import('node:net').Socket[] = []
    const server = createServer((socket) => {
      /* accept the connection and stay silent */
      sockets.push(socket)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as AddressInfo

    // No injected query: exercise the real TCP implementation and its timeout.
    const resolver = new WhoisMntResolver({
      whois: '127.0.0.1',
      whoisPort: port,
      whoisTimeoutMs: 150,
    })

    await expect(resolver.resolve('172.20.0.1')).rejects.toThrow('timed out')
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
