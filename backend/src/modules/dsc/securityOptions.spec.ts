import { describe, expect, it } from 'vitest'

import { securityOptionsSchema } from '@epass42/shared'
import { mergeSecurity, toSecurityOverlay } from './securityOptions'

describe('security option normalisation', () => {
  const defaults = securityOptionsSchema.parse({})

  it('maps a nested partial overlay onto the defaults', () => {
    const overlay = toSecurityOverlay({
      pace: { ecdhGm3des: false, ecdhGmAes128: true },
      aa: { enabled: true },
      ca: { enabled: true, keyId: 7 },
      ta: { enabled: true },
    })
    expect(mergeSecurity(defaults, overlay)).toEqual({
      pace: { ecdhGm3des: false, ecdhGmAes128: true },
      aa: { enabled: true, algorithm: 'rsaSha1' },
      ca: { enabled: true, keyId: 7 },
      ta: { ...defaults.ta, enabled: true },
    })
  })

  it('ignores the removed flat shape', () => {
    expect(
      toSecurityOverlay({
        paceEcdhGm3des: false,
        paceEcdhGmAes128: true,
        aa: true,
        ca: true,
        caKeyId: 7,
      }),
    ).toEqual({})
  })

  it('merges nested overlays without erasing untouched fields', () => {
    const merged = mergeSecurity(defaults, { ca: { enabled: true } }, { ca: { keyId: 3 } })
    expect(merged.ca).toEqual({ enabled: true, keyId: 3 })
  })
})
