/**
 * Test support helpers (not part of the production surface).
 *
 * Provides an in-memory application and a fake OIDC driver so the login flow,
 * realm isolation and admin authorization can be exercised without a live
 * identity provider (M4/T4.10).
 */
import {
  mergeConfig,
  parseConfig,
  type AppConfig,
  type OAuthProviderConfig,
  type RawConfig,
} from './config'
import { openDatabase, type DbHandle } from './db/client'
import { runMigrations } from './db/migrate'
import { buildApp, type BuiltApp } from './app'
import type { OidcDriver, OidcDriverFactory, OidcFlowStart } from './modules/auth/provider'
import type { MntResolver } from './modules/jurisdiction/whois'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A fake identity keyed by provider client id. */
export interface FakeIdentity {
  subject: string
  claims: Record<string, unknown>
}

/** A fake OIDC driver collection. */
export class FakeOidc {
  private readonly identities = new Map<string, FakeIdentity>()

  /** Registers the identity returned for a provider (by client id). */
  set(clientId: string, identity: FakeIdentity): void {
    this.identities.set(clientId, identity)
  }

  /** The factory injected into {@link buildApp}. */
  readonly factory: OidcDriverFactory = (provider: OAuthProviderConfig): OidcDriver => {
    const identities = this.identities
    return {
      provider,
      redirectUri: `http://localhost/auth/${provider.realm}/callback`,
      async start(): Promise<OidcFlowStart> {
        const state = `state-${provider.clientId}`
        return {
          url: `https://idp.test/authorize?state=${state}&client_id=${provider.clientId}`,
          state,
          nonce: `nonce-${provider.clientId}`,
          codeVerifier: `verifier-${provider.clientId}`,
        }
      },
      async complete(_currentUrl: string, flow: OidcFlowStart) {
        void flow
        const identity = identities.get(provider.clientId)
        if (!identity) throw new Error(`no fake identity for ${provider.clientId}`)
        return { subject: identity.subject, rawClaims: identity.claims }
      },
    }
  }
}

const PROVIDERS = [
  {
    realm: 'csca',
    issuer: 'https://csca.idp.test',
    clientId: 'csca-client',
    scopes: ['openid', 'email', 'dn42'],
  },
  {
    realm: 'cvca',
    issuer: 'https://cvca.idp.test',
    clientId: 'cvca-client',
    scopes: ['openid', 'email', 'dn42'],
  },
  {
    realm: 'dv',
    issuer: 'https://dv.idp.test',
    clientId: 'dv-client',
    scopes: ['openid', 'email', 'dn42'],
  },
  {
    realm: 'dsc',
    issuer: 'https://dsc.idp.test',
    clientId: 'dsc-client',
    scopes: ['openid', 'email', 'dn42'],
  },
  {
    realm: 'ml',
    issuer: 'https://ml.idp.test',
    clientId: 'ml-client',
    scopes: ['openid', 'email', 'dn42'],
  },
] as const

/** Base raw configuration used by every test (merged with per-test overrides). */
const TEST_CONFIG: RawConfig = {
  cookieSecure: false,
  sessionSecret: 'test-session-secret-0123456789',
  roles: ['pkd', 'csca', 'cvca', 'dv', 'dsc', 'ml'],
  adminMnts: {
    csca: ['EXAMPLE-CSCA-MNT'],
    cvca: ['EXAMPLE-CVCA-MNT'],
    dv: ['EXAMPLE-DV-MNT'],
    dsc: ['EXAMPLE-DSC-MNT'],
    ml: ['EXAMPLE-ML-MNT'],
  },
  csca: { bootstrap: false, keyBits: 2048 },
  cvca: { bootstrap: false, keyBits: 2048 },
  oauthProviders: PROVIDERS,
}

/** Builds a test configuration from raw (TOML-shaped) overrides. */
export function makeTestConfig(overrides: RawConfig = {}): AppConfig {
  return parseConfig(mergeConfig(TEST_CONFIG, overrides))
}

/** A static IP→maintainer resolver for tests (no network). */
export function staticMntResolver(map: Record<string, string[]> = {}): MntResolver {
  return {
    async resolve(ip: string) {
      return map[ip] ?? []
    },
  }
}

/** Builds an in-memory application with the fake OIDC driver. */
export async function makeTestApp(
  oidc: FakeOidc,
  overrides: RawConfig = {},
  mntResolver: MntResolver = staticMntResolver(),
): Promise<BuiltApp & { dbHandle: DbHandle }> {
  const config = makeTestConfig(overrides)
  // Keep generated artifacts out of the repository.
  config.dataDir = mkdtempSync(join(tmpdir(), 'epass42-artifacts-'))
  const dbHandle = openDatabase(':memory:')
  runMigrations(dbHandle)
  return buildApp({ config, dbHandle, driverFactory: oidc.factory, mntResolver, logger: false })
}
