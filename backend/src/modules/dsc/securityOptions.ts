/**
 * Security-option normalisation (M7).
 *
 * `SecurityOptions` is nested (`pace` / `aa` / `ca` / `ta`).  This module
 * converts a stored or submitted object into a partial overlay and deep-merges
 * overlays onto a full base.
 */
import { securityOptionsSchema, type SecurityOptions } from '@epass42/shared'

/** A partial overlay for {@link SecurityOptions} (each mechanism partial). */
export interface SecurityOptionsOverlay {
  pace?: Partial<SecurityOptions['pace']>
  aa?: Partial<SecurityOptions['aa']>
  ca?: Partial<SecurityOptions['ca']>
  ta?: Partial<SecurityOptions['ta']>
}

/** Drops `undefined` entries so an overlay never erases an existing value. */
function defined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

/** Converts a stored security object into a partial overlay. */
export function toSecurityOverlay(raw: unknown): SecurityOptionsOverlay {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Partial<SecurityOptions>
  const overlay: SecurityOptionsOverlay = {}

  if (source.pace && typeof source.pace === 'object') {
    overlay.pace = defined({
      ecdhGm3des: source.pace.ecdhGm3des,
      ecdhGmAes128: source.pace.ecdhGmAes128,
    })
  }

  if (source.aa && typeof source.aa === 'object') {
    overlay.aa = defined({
      enabled: source.aa.enabled,
      algorithm: source.aa.algorithm,
    })
  }

  if (source.ca && typeof source.ca === 'object') {
    overlay.ca = defined({
      enabled: source.ca.enabled,
      keyId: source.ca.keyId,
    })
  }

  if (source.ta && typeof source.ta === 'object') {
    overlay.ta = defined({
      enabled: source.ta.enabled,
      authorization: source.ta.authorization,
    })
  }

  return overlay
}

/** Deep-merges overlays onto a full base, ignoring undefined entries. */
export function mergeSecurity(
  base: SecurityOptions,
  ...overlays: (SecurityOptionsOverlay | undefined)[]
): SecurityOptions {
  const merged: SecurityOptions = {
    pace: { ...base.pace },
    aa: { ...base.aa },
    ca: { ...base.ca },
    ta: { ...base.ta },
  }
  for (const overlay of overlays) {
    Object.assign(merged.pace, defined(overlay?.pace ?? {}))
    Object.assign(merged.aa, defined(overlay?.aa ?? {}))
    Object.assign(merged.ca, defined(overlay?.ca ?? {}))
    Object.assign(merged.ta, defined(overlay?.ta ?? {}))
  }
  return merged
}

/** The schema defaults (used for a request that carries no security block). */
export const DEFAULT_SECURITY: SecurityOptions = securityOptionsSchema.parse({})

/** True when the profile emits at least one LDS2 application. */
export function isLds2Enabled(lds2: { enabled: boolean; roles: readonly unknown[] }): boolean {
  return lds2.enabled && lds2.roles.length > 0
}
