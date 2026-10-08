/**
 * Security-option normalisation (M7).
 *
 * `SecurityOptions` is nested (`pace` / `aa` / `ca`) since the LDS1/LDS2 split.
 * Older database profiles and signing requests still carry the flat shape
 * (`paceEcdhGm3des`, `paceEcdhGmAes128`, `aa`, `ca`, `caKeyId`), so this module
 * converts those legacy objects into a partial overlay and deep-merges
 * overlays onto a full base.
 */
import { securityOptionsSchema, type SecurityOptions } from '@epass42/shared'

/** A partial overlay for {@link SecurityOptions} (each mechanism partial). */
export interface SecurityOptionsOverlay {
  pace?: Partial<SecurityOptions['pace']>
  aa?: Partial<SecurityOptions['aa']>
  ca?: Partial<SecurityOptions['ca']>
}

/** Drops `undefined` entries so an overlay never erases an existing value. */
function defined<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

/** Converts a stored / legacy security object into a partial overlay. */
export function toSecurityOverlay(raw: unknown): SecurityOptionsOverlay {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const overlay: SecurityOptionsOverlay = {}

  const pace = source.pace
  if (pace && typeof pace === 'object') {
    const value = pace as Record<string, unknown>
    overlay.pace = defined({
      ecdhGm3des: value.ecdhGm3des as boolean | undefined,
      ecdhGmAes128: value.ecdhGmAes128 as boolean | undefined,
    })
  } else if (
    typeof source.paceEcdhGm3des === 'boolean' ||
    typeof source.paceEcdhGmAes128 === 'boolean'
  ) {
    overlay.pace = defined({
      ecdhGm3des: source.paceEcdhGm3des as boolean | undefined,
      ecdhGmAes128: source.paceEcdhGmAes128 as boolean | undefined,
    })
  }

  const aa = source.aa
  if (typeof aa === 'boolean') {
    overlay.aa = { enabled: aa }
  } else if (aa && typeof aa === 'object') {
    const value = aa as Record<string, unknown>
    overlay.aa = defined({
      enabled: value.enabled as boolean | undefined,
      algorithm: value.algorithm as SecurityOptions['aa']['algorithm'] | undefined,
    })
  }

  const ca = source.ca
  const caOverlay: Partial<SecurityOptions['ca']> = {}
  if (typeof ca === 'boolean') {
    caOverlay.enabled = ca
  } else if (ca && typeof ca === 'object') {
    const value = ca as Record<string, unknown>
    if (typeof value.enabled === 'boolean') caOverlay.enabled = value.enabled
    if (value.algorithm !== undefined) {
      caOverlay.algorithm = value.algorithm as SecurityOptions['ca']['algorithm']
    }
    if (typeof value.keyId === 'number') caOverlay.keyId = value.keyId
  }
  // Legacy profiles stored the CA key id at the top level.
  if (typeof source.caKeyId === 'number') caOverlay.keyId = source.caKeyId
  if (Object.keys(caOverlay).length > 0) overlay.ca = caOverlay

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
  }
  for (const overlay of overlays) {
    Object.assign(merged.pace, defined(overlay?.pace ?? {}))
    Object.assign(merged.aa, defined(overlay?.aa ?? {}))
    Object.assign(merged.ca, defined(overlay?.ca ?? {}))
  }
  return merged
}

/** The schema defaults (used for a request that carries no security block). */
export const DEFAULT_SECURITY: SecurityOptions = securityOptionsSchema.parse({})

/** True when the profile emits at least one LDS2 application. */
export function isLds2Enabled(lds2: { enabled: boolean; roles: readonly unknown[] }): boolean {
  return lds2.enabled && lds2.roles.length > 0
}
