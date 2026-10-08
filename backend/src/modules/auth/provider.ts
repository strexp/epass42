/**
 * OAuth/OIDC provider registration and the authorization-code driver (M4).
 *
 * Providers are declared in configuration and seeded into `oauth_provider`.
 * The production driver uses `openid-client` (dynamic discovery, PKCE, state,
 * nonce); tests inject a fake driver through {@link OidcDriverFactory} so the
 * whole login flow can run without a live identity provider.
 */
import * as client from 'openid-client'
import { eq } from 'drizzle-orm'

import type { OAuthProviderConfig } from '../../config'
import type { Db } from '../../db/client'
import { oauthProvider } from '../../db/schema'
import { realmSchema, type AppConfig } from '../../config'
import type { Realm } from '@pkd42/shared'

/** A started authorization-code flow (persisted in `oauth_flow`). */
export interface OidcFlowStart {
  url: string
  state: string
  nonce: string
  codeVerifier: string
}

/** The claims derived from a completed flow. */
export interface OidcIdentity {
  subject: string
  rawClaims: Record<string, unknown>
}

/** A driver for one provider. */
export interface OidcDriver {
  readonly provider: OAuthProviderConfig
  readonly redirectUri: string
  /** Starts a new authorization-code flow. */
  start(): Promise<OidcFlowStart>
  /** Completes the flow from the current callback URL and persisted state. */
  complete(currentUrl: string, flow: OidcFlowStart): Promise<OidcIdentity>
}

export type OidcDriverFactory = (provider: OAuthProviderConfig, redirectUri: string) => OidcDriver

/** The production `openid-client` driver. */
export class OpenidClientDriver implements OidcDriver {
  private constructor(
    readonly provider: OAuthProviderConfig,
    readonly redirectUri: string,
    private readonly configuration: client.Configuration,
  ) {}

  static async create(
    provider: OAuthProviderConfig,
    redirectUri: string,
  ): Promise<OpenidClientDriver> {
    const configuration = await client.discovery(new URL(provider.issuer), provider.clientId, {
      client_secret: provider.clientSecret,
      redirect_uris: [redirectUri],
    })
    return new OpenidClientDriver(provider, redirectUri, configuration)
  }

  async start(): Promise<OidcFlowStart> {
    const codeVerifier = client.randomPKCECodeVerifier()
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
    const state = client.randomState()
    const nonce = client.randomNonce()
    const url = client.buildAuthorizationUrl(this.configuration, {
      redirect_uri: this.redirectUri,
      scope: this.provider.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    return { url: url.href, state, nonce, codeVerifier }
  }

  async complete(currentUrl: string, flow: OidcFlowStart): Promise<OidcIdentity> {
    const tokens = await client.authorizationCodeGrant(this.configuration, new URL(currentUrl), {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    })
    const claims = tokens.claims()
    if (!claims?.sub) throw new Error('identity provider returned no subject')
    let rawClaims: Record<string, unknown> = { ...(claims as Record<string, unknown>) }
    if (tokens.access_token) {
      try {
        const userInfo = await client.fetchUserInfo(
          this.configuration,
          tokens.access_token,
          String(claims.sub),
        )
        rawClaims = { ...rawClaims, ...(userInfo as Record<string, unknown>) }
      } catch {
        // Userinfo is optional; the ID token claims are authoritative.
      }
    }
    return { subject: String(claims.sub), rawClaims }
  }
}

/** A provider together with its seeded database id. */
export interface ProviderRecord {
  id: number
  config: OAuthProviderConfig
}

/** Upserts configured providers into `oauth_provider` and returns them with ids. */
export function seedProviders(db: Db, config: AppConfig): ProviderRecord[] {
  const records: ProviderRecord[] = []
  for (const provider of config.oauthProviders) {
    const existing = db
      .select()
      .from(oauthProvider)
      .all()
      .find(
        (row) =>
          row.realm === provider.realm &&
          row.issuer === provider.issuer &&
          row.clientId === provider.clientId,
      )
    const values = {
      realm: provider.realm,
      issuer: provider.issuer,
      clientId: provider.clientId,
      scopes: provider.scopes.join(' '),
      claimMap: JSON.stringify(provider.claimMap),
      enabled: provider.enabled,
    }
    let id: number
    if (existing) {
      db.update(oauthProvider).set(values).where(eq(oauthProvider.id, existing.id)).run()
      id = existing.id
    } else {
      const result = db.insert(oauthProvider).values(values).run()
      id = Number(result.lastInsertRowid)
    }
    records.push({ id, config: provider })
  }
  return records
}

/** Slugifies an issuer host into a URL-safe alias. */
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'provider'
  )
}

/** The default alias for a provider (issuer host). */
function defaultAlias(provider: OAuthProviderConfig): string {
  try {
    return slugify(new URL(provider.issuer).hostname)
  } catch {
    return slugify(provider.clientId)
  }
}

/** Registry of providers keyed by realm. */
export class AuthProviders {
  private readonly byId = new Map<number, ProviderRecord>()
  private readonly aliases = new Map<number, string>()
  private readonly byAliasKey = new Map<string, ProviderRecord>()
  private readonly drivers = new Map<number, OidcDriver>()

  constructor(
    records: ProviderRecord[],
    private readonly factory: OidcDriverFactory,
    private readonly publicUrl: string,
  ) {
    const used = new Set<string>()
    for (const record of records) {
      if (!record.config.enabled) continue
      this.byId.set(record.id, record)
      const realm = record.config.realm
      const base = record.config.alias ?? defaultAlias(record.config)
      let alias = base
      let counter = 2
      while (used.has(`${realm}:${alias}`)) alias = `${base}-${counter++}`
      used.add(`${realm}:${alias}`)
      this.aliases.set(record.id, alias)
      this.byAliasKey.set(`${realm}:${alias}`, record)
    }
  }

  /** The alias of a provider. */
  aliasOf(id: number): string {
    return this.aliases.get(id) ?? String(id)
  }

  /** Enabled providers for a realm. */
  list(realm: Realm): ProviderRecord[] {
    return [...this.byId.values()].filter((record) => record.config.realm === realm)
  }

  /** Looks up a provider by id, restricted to a realm. */
  get(realm: Realm, id: number): ProviderRecord | undefined {
    const record = this.byId.get(id)
    return record && record.config.realm === realm ? record : undefined
  }

  /** Looks up a provider by its alias within a realm. */
  byAlias(realm: Realm, alias: string): ProviderRecord | undefined {
    return this.byAliasKey.get(`${realm}:${alias}`)
  }

  /** Resolves a provider from an id (numeric) or an alias. */
  resolve(realm: Realm, idOrAlias: string | number | undefined): ProviderRecord | undefined {
    if (idOrAlias === undefined || idOrAlias === '') {
      return this.list(realm)[0]
    }
    if (typeof idOrAlias === 'number') return this.get(realm, idOrAlias)
    if (/^\d+$/.test(idOrAlias))
      return this.get(realm, Number(idOrAlias)) ?? this.byAlias(realm, idOrAlias)
    return this.byAlias(realm, idOrAlias)
  }

  /** Returns (and caches) the driver for a provider. */
  driver(record: ProviderRecord): OidcDriver {
    const cached = this.drivers.get(record.id)
    if (cached) return cached
    // The alias is part of the callback path so each login method has a
    // distinct, registrable redirect URI.
    const redirectUri = `${this.publicUrl.replace(/\/$/, '')}/auth/${record.config.realm}/callback/${this.aliasOf(record.id)}`
    const driver = this.factory(record.config, redirectUri)
    this.drivers.set(record.id, driver)
    return driver
  }
}

export { realmSchema }
