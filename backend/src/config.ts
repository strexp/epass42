/**
 * Configuration loading (M3/T3.2).
 *
 * Values come from environment variables, optionally overlaid by a TOML file
 * (default `config.toml`, or `PKD42_CONFIG`).  Everything is validated with zod
 * so a misconfiguration fails fast at startup.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import { COUNTRY_ALPHA2, COUNTRY_ALPHA3 } from '@pkd42/shared'

export const realmSchema = z.enum(['csca', 'dsc'])
export const roleSchema = z.enum(['pkd', 'csca', 'dsc'])

/** The default (insecure) session secret used in development, also a legacy KEK. */
export const DEV_SESSION_SECRET = 'dev-insecure-session-secret-change-me'

/** One configured OAuth provider (M4/T4.1). */
export const oauthProviderSchema = z.object({
  realm: realmSchema,
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  /**
   * Short, URL-safe login-method alias used in the callback path and shown in
   * the login chooser.  Defaults to a slug of the issuer host.
   */
  alias: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'alias may only contain letters, digits, - and _')
    .optional(),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
  /** Maps claim paths, e.g. `{ asn: 'dn42.asn' }`. */
  claimMap: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
})
export type OAuthProviderConfig = z.infer<typeof oauthProviderSchema>

const niaDscSchema = z.object({
  commonName: z.string().default('pkd42 NIA DSC'),
  documentTypes: z.array(z.string()).default(['P']),
  validityYears: z.number().int().min(1).default(10),
  privateKeyUsageYears: z.number().int().min(1).default(3),
  keyBits: z.number().int().default(2048),
  pss: z.boolean().default(false),
})

const cscaSchema = z.object({
  commonName: z.string().default('pkd42 CSCA'),
  organization: z.string().optional(),
  locality: z.string().default(COUNTRY_ALPHA3),
  validityYears: z.number().int().min(1).default(13),
  privateKeyUsageYears: z.number().int().min(1).default(4),
  keyBits: z.number().int().default(4096),
  hash: z.enum(['SHA-256', 'SHA-384', 'SHA-512']).default('SHA-256'),
  pss: z.boolean().default(false),
  crlDistributionPoints: z.array(z.string()).default([`ldap://pkd42.local/c=${COUNTRY_ALPHA2}`]),
  /** Generate a CSCA key at startup when none exists. */
  bootstrap: z.boolean().default(true),
  niaDsc: niaDscSchema.prefault({}),
})

const configSchema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(3000),
  publicUrl: z.string().url().default('http://localhost:3000'),
  /**
   * Browser-facing frontend base URL.  After login the callback redirects here.
   * Empty means same origin as `publicUrl`.
   */
  frontendUrl: z.string().default(''),
  roles: z.array(roleSchema).default(['pkd', 'csca', 'dsc']),
  countryAlpha2: z.string().length(2).default(COUNTRY_ALPHA2),
  countryAlpha3: z.string().length(3).default(COUNTRY_ALPHA3),
  databasePath: z.string().default('./data/pkd42.db'),
  runMigrations: z.boolean().default(true),
  /** Directory for generated artifacts (perso, …). */
  dataDir: z.string().default('./data'),
  sessionSecret: z.string().min(16).default(DEV_SESSION_SECRET),
  sessionTtlSeconds: z
    .number()
    .int()
    .min(60)
    .default(60 * 60 * 24 * 7),
  cookieSecure: z.boolean().default(true),
  cookieDomain: z.string().optional(),
  /** Base64 32-byte KEK for envelope encryption (M13); optional in dev. */
  encryptionKek: z.string().optional(),
  trustProxy: z.boolean().default(false),
  rateLimit: z
    .object({
      max: z.number().int().min(0).default(120),
      windowMs: z.number().int().min(1000).default(60_000),
    })
    .default({ max: 120, windowMs: 60_000 }),
  smtp: z
    .object({
      url: z.string().optional(),
      from: z.string().default('pkd42 <no-reply@localhost>'),
    })
    .default({ from: 'pkd42 <no-reply@localhost>' }),
  adminMnts: z
    .object({
      csca: z.array(z.string()).default([]),
      dsc: z.array(z.string()).default([]),
    })
    .default({ csca: [], dsc: [] }),
  /** Also treat any `mnt_by` entry as an admin MNT. */
  adminIncludeMntBy: z.boolean().default(false),
  oauthProviders: z.array(oauthProviderSchema).default([]),
  csca: cscaSchema.prefault({}),
  issuing: z
    .object({
      issuingState: z.string().length(3).default(COUNTRY_ALPHA3),
      issuingAuthority: z.string().default('NIA'),
      personalizationDevice: z.string().default('PKD42'),
      dg13Policy: z.string().default('utf8-text'),
      /** Document validity, in years, applied to the server-computed expiry. */
      validityYears: z.number().int().min(1).max(30).default(10),
      /** Default eMRTD security mechanisms chosen by the administrator. */
      security: z
        .object({
          paceEcdhGm3des: z.boolean().default(true),
          paceEcdhGmAes128: z.boolean().default(true),
          caEcdh3des: z.boolean().default(false),
          caEcdhAes128: z.boolean().default(false),
          caKeyId: z.number().int().min(0).max(255).default(1),
          aa: z.boolean().default(false),
        })
        .prefault({}),
    })
    .prefault({}),
  /** Static IP-prefix to ASN map used to resolve the requesting AS. */
  jurisdiction: z
    .object({
      routes: z.array(z.object({ prefix: z.string(), asn: z.number().int() })).default([]),
    })
    .prefault({}),
  crl: z
    .object({
      autoGenerate: z.boolean().default(true),
      maxAgeDays: z.number().int().min(1).default(90),
      minIntervalHours: z.number().int().min(1).default(48),
    })
    .prefault({}),
  pkd: z
    .object({
      /** Directory base DN (defaults to the ICAO PKD download area). */
      baseDn: z.string().optional(),
    })
    .prefault({}),
  ldap: z
    .object({
      enabled: z.boolean().default(false),
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(3890),
    })
    .prefault({}),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type AppConfig = z.infer<typeof configSchema>

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv
  /** Explicit TOML path; defaults to `$PKD42_CONFIG` or `./config.toml`. */
  configPath?: string
  cwd?: string
}

type RawConfig = Record<string, unknown>

function envBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return /^(1|true|yes|on)$/i.test(value)
}

function envList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function envInt(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Reads the optional TOML file. */
function readToml(path: string | undefined, cwd: string): RawConfig {
  if (!path) return {}
  const absolute = resolve(cwd, path)
  if (!existsSync(absolute)) return {}
  return parseToml(readFileSync(absolute, 'utf8')) as RawConfig
}

/** Builds the raw config from environment variables. */
function fromEnv(env: NodeJS.ProcessEnv): RawConfig {
  const raw: RawConfig = {}
  if (env.NODE_ENV) raw.env = env.NODE_ENV
  if (env.PKD42_ENV) raw.env = env.PKD42_ENV
  if (env.PKD42_HOST) raw.host = env.PKD42_HOST
  const port = envInt(env.PKD42_PORT)
  if (port !== undefined) raw.port = port
  if (env.PKD42_PUBLIC_URL) raw.publicUrl = env.PKD42_PUBLIC_URL
  if (env.PKD42_FRONTEND_URL !== undefined) raw.frontendUrl = env.PKD42_FRONTEND_URL
  const roles = envList(env.PKD42_ROLES)
  if (roles) raw.roles = roles
  if (env.PKD42_COUNTRY_ALPHA2) raw.countryAlpha2 = env.PKD42_COUNTRY_ALPHA2
  if (env.PKD42_COUNTRY_ALPHA3) raw.countryAlpha3 = env.PKD42_COUNTRY_ALPHA3
  if (env.PKD42_DB_PATH) raw.databasePath = env.PKD42_DB_PATH
  if (env.PKD42_DATA_DIR) raw.dataDir = env.PKD42_DATA_DIR
  const runMigrations = envBool(env.PKD42_RUN_MIGRATIONS)
  if (runMigrations !== undefined) raw.runMigrations = runMigrations
  if (env.PKD42_SESSION_SECRET) raw.sessionSecret = env.PKD42_SESSION_SECRET
  const ttl = envInt(env.PKD42_SESSION_TTL)
  if (ttl !== undefined) raw.sessionTtlSeconds = ttl
  const cookieSecure = envBool(env.PKD42_COOKIE_SECURE)
  if (cookieSecure !== undefined) raw.cookieSecure = cookieSecure
  if (env.PKD42_COOKIE_DOMAIN) raw.cookieDomain = env.PKD42_COOKIE_DOMAIN
  if (env.PKD42_ENCRYPTION_KEK) raw.encryptionKek = env.PKD42_ENCRYPTION_KEK
  const trustProxy = envBool(env.PKD42_TRUST_PROXY)
  if (trustProxy !== undefined) raw.trustProxy = trustProxy
  const rateMax = envInt(env.PKD42_RATE_LIMIT_MAX)
  const rateWindow = envInt(env.PKD42_RATE_LIMIT_WINDOW)
  if (rateMax !== undefined || rateWindow !== undefined) {
    raw.rateLimit = { max: rateMax, windowMs: rateWindow }
  }
  if (env.PKD42_SMTP_URL || env.PKD42_MAIL_FROM) {
    raw.smtp = { url: env.PKD42_SMTP_URL, from: env.PKD42_MAIL_FROM }
  }
  if (env.PKD42_CSCA_ADMIN_MNTS || env.PKD42_DSC_ADMIN_MNTS) {
    raw.adminMnts = {
      csca: envList(env.PKD42_CSCA_ADMIN_MNTS),
      dsc: envList(env.PKD42_DSC_ADMIN_MNTS),
    }
  }
  const includeMntBy = envBool(env.PKD42_ADMIN_INCLUDE_MNT_BY)
  if (includeMntBy !== undefined) raw.adminIncludeMntBy = includeMntBy
  if (env.PKD42_LOG_LEVEL) raw.logLevel = env.PKD42_LOG_LEVEL
  if (
    env.PKD42_CSCA_CN ||
    env.PKD42_CSCA_KEY_BITS ||
    env.PKD42_CSCA_CRL_DP ||
    env.PKD42_CSCA_BOOTSTRAP
  ) {
    raw.csca = {
      commonName: env.PKD42_CSCA_CN,
      keyBits: envInt(env.PKD42_CSCA_KEY_BITS),
      crlDistributionPoints: envList(env.PKD42_CSCA_CRL_DP),
      bootstrap: envBool(env.PKD42_CSCA_BOOTSTRAP),
    }
  }
  if (env.PKD42_PKD_BASE_DN) raw.pkd = { baseDn: env.PKD42_PKD_BASE_DN }
  if (env.PKD42_JURISDICTION_ROUTES) {
    raw.jurisdiction = { routes: JSON.parse(env.PKD42_JURISDICTION_ROUTES) }
  }
  if (
    env.PKD42_LDAP_ENABLED !== undefined ||
    env.PKD42_LDAP_PORT !== undefined ||
    env.PKD42_LDAP_HOST
  ) {
    raw.ldap = {
      enabled: envBool(env.PKD42_LDAP_ENABLED),
      host: env.PKD42_LDAP_HOST,
      port: envInt(env.PKD42_LDAP_PORT),
    }
  }
  if (env.PKD42_OAUTH_PROVIDERS) {
    raw.oauthProviders = JSON.parse(env.PKD42_OAUTH_PROVIDERS)
  }
  return raw
}

/** Shallow-merges two levels of plain objects. */
function merge(base: RawConfig, overlay: RawConfig): RawConfig {
  const result: RawConfig = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    const current = result[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      result[key] = merge(current as RawConfig, value as RawConfig)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Loads and validates the application configuration.  The TOML file is the
 * base and environment variables override it.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const configPath = options.configPath ?? env.PKD42_CONFIG ?? 'config.toml'
  const fileConfig = readToml(configPath, cwd)
  const merged = merge(fileConfig, fromEnv(env))
  const parsed = configSchema.parse(merged)
  // In development the Nuxt dev server runs on :3001 by default.
  if (parsed.frontendUrl === '' && parsed.env === 'development') {
    parsed.frontendUrl = 'http://localhost:3001'
  }
  if (parsed.env === 'production' && parsed.sessionSecret.startsWith('dev-insecure')) {
    throw new Error('PKD42_SESSION_SECRET must be set in production')
  }
  return parsed
}
