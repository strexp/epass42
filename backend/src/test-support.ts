/**
 * Test support helpers (not part of the production surface).
 *
 * Provides an in-memory application and a fake OIDC driver so the login flow,
 * realm isolation and admin authorization can be exercised without a live
 * identity provider (M4/T4.10).
 */
import type { AppConfig } from './config'
import { loadConfig } from './config'
import { openDatabase, type DbHandle } from './db/client'
import { runMigrations } from './db/migrate'
import { buildApp, type BuiltApp } from './app'
import type { OidcDriver, OidcDriverFactory, OidcFlowStart } from './modules/auth/provider'
import type { OAuthProviderConfig } from './config'
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
    realm: 'dsc',
    issuer: 'https://dsc.idp.test',
    clientId: 'dsc-client',
    scopes: ['openid', 'email', 'dn42'],
  },
] as const

/** Builds a test configuration. */
export function makeTestConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    configPath: '/nonexistent-pkd42-config.toml',
    env: {
      PKD42_COOKIE_SECURE: 'false',
      PKD42_SESSION_SECRET: 'test-session-secret-0123456789',
      PKD42_ROLES: 'pkd,csca,dsc',
      PKD42_CSCA_ADMIN_MNTS: 'EXAMPLE-CSCA-MNT',
      PKD42_DSC_ADMIN_MNTS: 'EXAMPLE-DSC-MNT',
      PKD42_CSCA_BOOTSTRAP: 'false',
      PKD42_CSCA_KEY_BITS: '2048',
      PKD42_OAUTH_PROVIDERS: JSON.stringify(PROVIDERS),
      ...overrides,
    },
  })
}

/** Builds an in-memory application with the fake OIDC driver. */
export async function makeTestApp(
  oidc: FakeOidc,
  overrides: Record<string, string> = {},
): Promise<BuiltApp & { dbHandle: DbHandle }> {
  const config = makeTestConfig(overrides)
  // Keep generated artifacts out of the repository.
  config.dataDir = mkdtempSync(join(tmpdir(), 'pkd42-artifacts-'))
  const dbHandle = openDatabase(':memory:')
  runMigrations(dbHandle)
  return buildApp({ config, dbHandle, driverFactory: oidc.factory, logger: false })
}
