import { describe, expect, it } from 'vitest'

import { renderEmrtdScript } from './script'

describe('eMRTD perso script', () => {
  it('renders the Terminal Authentication directives', () => {
    const script = renderEmrtdScript([
      {
        role: 'lds1',
        documentNumber: 'L898902C<',
        dateOfBirth: '690806',
        dateOfExpiry: '940623',
        dataGroups: [],
        taDate: '240101',
        trustPoints: [
          {
            publicKey: new Uint8Array([0x04, ...new Array(64).fill(0x11)]),
            car: 'UTCVCA0000000001',
            effective: '240101',
            authorization: new Uint8Array([0x03, 0x0f, 0x0f, 0x0f]),
          },
          {
            publicKey: new Uint8Array([0x04, ...new Array(64).fill(0x22)]),
            car: 'UTCVCA0000000002',
            effective: '240201',
            authorization: new Uint8Array([0x00, 0x0f, 0x00, 0x00]),
            secondary: true,
          },
        ],
      },
    ])
    expect(script).toContain('@ta-date 240101')
    expect(script).toContain('@cvca 04')
    expect(script).toContain('UTCVCA0000000001 240101 030F0F0F')
    expect(script).toContain('UTCVCA0000000002 240201 000F0000 secondary')
  })

  it('renders the AA algorithm and RSA-PSS trust-point directives', () => {
    const script = renderEmrtdScript([
      {
        role: 'lds1',
        documentNumber: 'L898902C<',
        dateOfBirth: '690806',
        dateOfExpiry: '940623',
        dataGroups: [],
        aaEcKey: new Uint8Array(32).fill(0xaa),
        aaAlgorithm: 'ecdsa',
        trustPoints: [
          {
            modulus: new Uint8Array([0x00, 0x81, 0x02]),
            exponent: new Uint8Array([0x01, 0x00, 0x01]),
            car: 'XDRSADV000000001',
            effective: '240301',
            authorization: new Uint8Array([0x00, 0x00, 0x00, 0x00]),
          },
        ],
      },
    ])
    expect(script).toContain(`@aa-ec ${'AA'.repeat(32)}`)
    expect(script).toContain('@aa-alg ecdsa')
    expect(script).toMatch(/^@cvca-rsa 008102 010001 XDRSADV000000001 240301 00000000$/m)
  })
})
