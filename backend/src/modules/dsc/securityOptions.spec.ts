import { describe, expect, it } from 'vitest'

import { securityOptionsSchema } from '@epass42/shared'
import { mergeSecurity, toSecurityOverlay } from './securityOptions'

describe('security option normalisation', () => {
  const defaults = securityOptionsSchema.parse({})

  it('maps the legacy flat shape onto the nested options', () => {
    const overlay = toSecurityOverlay({
      paceEcdhGm3des: false,
      paceEcdhGmAes128: true,
      aa: true,
      ca: true,
      caKeyId: 7,
    })
    expect(mergeSecurity(defaults, overlay)).toEqual({
      pace: { ecdhGm3des: false, ecdhGmAes128: true },
      aa: { enabled: true, algorithm: 'rsaSha1' },
      ca: { enabled: true, keyId: 7 },
      ta: defaults.ta,
    })
  })

  it('merges nested overlays without erasing untouched fields', () => {
    const merged = mergeSecurity(defaults, { ca: { enabled: true } }, { ca: { keyId: 3 } })
    expect(merged.ca).toEqual({ enabled: true, keyId: 3 })
  })
})
