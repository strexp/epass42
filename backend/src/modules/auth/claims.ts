/**
 * dn42 claim mapping (M4/T4.5).
 *
 * The `dn42` claim carries the autonomous system, active maintainer, `mnt_by`
 * and the announced routes; standard OIDC claims carry email and display name.
 * `claim_map` in the provider configuration can override the source paths.
 */
import type { OAuthProviderConfig } from '../../config'

/** The identity fields pkd42 consumes. */
export interface Dn42Identity {
  issuer: string
  subject: string
  email?: string
  name?: string
  preferredUsername?: string
  activeMnt?: string
  activeName?: string
  mntBy: string[]
  route: string[]
  route6: string[]
  timestamp?: number
  /** The full claim set, for prefill and debugging. */
  raw: Record<string, unknown>
}

/** Reads a dotted path from a nested object. */
export function getPath(source: unknown, path: string): unknown {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Maps raw claims to {@link Dn42Identity} using the provider's `claim_map`. */
export function mapClaims(
  raw: Record<string, unknown>,
  provider: OAuthProviderConfig,
  issuer: string,
): Dn42Identity {
  const map = provider.claimMap
  const dn42 = (getPath(raw, map.dn42 ?? 'dn42') ?? {}) as Record<string, unknown>
  const subject = asString(getPath(raw, map.subject ?? 'sub')) ?? ''
  if (subject === '') throw new Error('claims are missing a subject')

  return {
    issuer,
    subject,
    email: asString(getPath(raw, map.email ?? 'email')),
    name: asString(getPath(raw, map.name ?? 'name')),
    preferredUsername: asString(getPath(raw, map.preferredUsername ?? 'preferred_username')),
    activeMnt: asString(dn42.active_mnt ?? getPath(raw, map.activeMnt ?? 'dn42.active_mnt')),
    activeName: asString(dn42.active_name ?? getPath(raw, map.activeName ?? 'dn42.active_name')),
    mntBy: asStringArray(dn42.mnt_by ?? getPath(raw, map.mntBy ?? 'dn42.mnt_by')),
    route: asStringArray(dn42.route ?? getPath(raw, map.route ?? 'dn42.route')),
    route6: asStringArray(dn42.route6 ?? getPath(raw, map.route6 ?? 'dn42.route6')),
    timestamp: asNumber(dn42.timestamp ?? getPath(raw, map.timestamp ?? 'dn42.timestamp')),
    raw,
  }
}
