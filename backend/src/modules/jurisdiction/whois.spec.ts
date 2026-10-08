import { describe, expect, it } from 'vitest'

import { canonicalMnts, mntIncludes, parseMntBy } from './whois'

const ROUTE_OBJECT = `% Information related to '172.20.0.0/16AS4242420001'

route:          172.20.0.0/16
origin:         AS4242420001
mnt-by:         EXAMPLE-MNT
mnt-by:         OTHER-MNT
source:         DN42
`

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
