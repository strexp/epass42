import { describe, expect, it } from 'vitest'

import { renderEmrtdScript } from './script'

describe('perso script writer', () => {
  it('renders an LDS1 section with the expected directives', () => {
    const script = renderEmrtdScript([
      {
        role: 'lds1',
        documentNumber: 'L898902C<',
        dateOfBirth: '690806',
        dateOfExpiry: '940623',
        dataGroups: [
          { number: 1, bytes: new Uint8Array([0x61, 0x01, 0x00]) },
          { number: 2, bytes: new Uint8Array([0x75, 0x01, 0x00]) },
        ],
        cardAccess: new Uint8Array([0x31, 0x00]),
        sod: new Uint8Array([0x77, 0x01, 0x00]),
      },
    ])
    expect(script).toContain('@instance A0000002471001')
    expect(script).toContain('@doc L898902C<')
    expect(script).toContain('@dg 1 610100')
    expect(script).toContain('@dg 2 750100')
    expect(script).toContain('@cardaccess 3100')
    expect(script).toContain('@sod 770100')
  })

  it('renders an LDS2 section with records and transparent files', () => {
    const script = renderEmrtdScript([
      {
        role: 'travel',
        documentNumber: 'L898902C<',
        dateOfBirth: '690806',
        dateOfExpiry: '940623',
        dataGroups: [],
        records: [{ fid: '0101', bytes: new Uint8Array([0x5f, 0x44, 0x03, 0x55, 0x53, 0x41]) }],
        transparent: [{ fid: '0201', bytes: new Uint8Array([0x7f, 0x61, 0x01, 0x00]) }],
      },
    ])
    expect(script).toContain('@instance A0000002472001')
    expect(script).toContain('@lds2 travel')
    expect(script).toContain('@record 0101 5F4403555341')
    expect(script).toContain('@transparent 0201 7F610100')
  })
})
