/**
 * Configuration loading (M3/T3.2).
 *
 * Configuration comes from a single TOML file (`config.toml` by default).
 * Everything is validated with zod so a misconfiguration fails fast at startup.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import {
  COUNTRY_ALPHA2,
  COUNTRY_ALPHA3,
  documentTypeListSchema,
  dvPermissionsSchema,
} from '@epass42/shared'

export const realmSchema = z.enum(['csca', 'cvca', 'dv', 'dsc'])
export const roleSchema = z.enum(['pkd', 'csca', 'cvca', 'dv', 'dsc'])

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
  commonName: z.string().default('ePass 42 NIA DSC'),
  /**
   * Authorized document types (Doc 9303-12 §7.1.1).  `P` is TD3, `ID`/`IP`
   * are TD1 and `I` is the wildcard covering every `I*` type.  The default
   * authorizes both passports and ID-1 documents on the single NIA DSC.
   */
  documentTypes: documentTypeListSchema.default(['P', 'I']),
  validityYears: z.number().int().min(1).default(10),
  privateKeyUsageYears: z.number().int().min(1).default(3),
  /** DSC key algorithm; may differ from the CSCA (Doc 9303-12 §4.1.5). */
  algorithm: z.enum(['rsa', 'ecdsa']).default('rsa'),
  curve: z.enum(['P-256', 'P-384']).default('P-256'),
  keyBits: z.number().int().default(2048),
  pss: z.boolean().default(false),
  hash: z.enum(['SHA-256', 'SHA-384', 'SHA-512']).default('SHA-256'),
})

const cscaSchema = z.object({
  commonName: z.string().default('ePass 42 CSCA'),
  /** Organisation (`O`) placed in the CSCA and DSC subject names. */
  organization: z.string().default('ePass 42'),
  /** Optional organisational unit (`OU`) in the subject names. */
  organizationalUnit: z.string().optional(),
  locality: z.string().default(COUNTRY_ALPHA3),
  /** CSCA key algorithm (Doc 9303-12 §4.1.5 allows RSA/DSA/ECDSA). */
  algorithm: z.enum(['rsa', 'ecdsa']).default('rsa'),
  curve: z.enum(['P-256', 'P-384']).default('P-256'),
  validityYears: z.number().int().min(1).default(13),
  privateKeyUsageYears: z.number().int().min(1).default(4),
  keyBits: z.number().int().default(4096),
  hash: z.enum(['SHA-256', 'SHA-384', 'SHA-512']).default('SHA-256'),
  pss: z.boolean().default(false),
  crlDistributionPoints: z.array(z.string()).default([`ldap://epass42.local/c=${COUNTRY_ALPHA2}`]),
  /** Generate a CSCA key at startup when none exists. */
  bootstrap: z.boolean().default(true),
  niaDsc: niaDscSchema.prefault({}),
})

/**
 * CVCA (Doc 9303-12 §3.2/§4.2): the authorization-PKI trust anchor.  It issues
 * card-verifiable DV certificates and is bootstrapped as a self-signed root.
 */
const cvcaSchema = z.object({
  commonName: z.string().default('ePass 42 CVCA'),
  /** Holder mnemonic used in the CVCA Certificate Holder Reference (max 9). */
  holderMnemonic: z.string().max(9).default('CVCA'),
  /**
   * CVCA key algorithm.  `ecdsa` (P-256) is required for Terminal
   * Authentication trust points; `rsa` is kept for legacy use.
   */
  algorithm: z.enum(['ecdsa', 'rsa']).default('ecdsa'),
  /** CVCA public key validity (months); the profile caps it at 3 years. */
  validityMonths: z.number().int().min(1).max(36).default(36),
  keyBits: z.number().int().default(2048),
  hash: z.enum(['SHA-256', 'SHA-384', 'SHA-512']).default('SHA-256'),
  pss: z.boolean().default(false),
  /** Generate a CVCA key at startup when none exists. */
  bootstrap: z.boolean().default(true),
  /** The authorization the CVCA grants in its certificate and trust point. */
  authorization: dvPermissionsSchema.default({
    epassport: { dg3: true, dg4: true },
    travel: { read: true, write: true },
    visa: { read: true, write: true },
    biometrics: { read: true, write: true },
  }),
  dv: z
    .object({
      /** DV public key validity (days); the profile caps it at 3 months. */
      validityDays: z.number().int().min(1).max(92).default(90),
      keyBits: z.number().int().default(2048),
      pss: z.boolean().default(false),
      /** Permissions pre-selected in the application form. */
      defaultPermissions: dvPermissionsSchema,
      /** The CVCA-issued default (system) DV maintainers may delegate to. */
      defaultDv: z
        .object({
          commonName: z.string().optional(),
          holderMnemonic: z.string().max(9).default('NIADV'),
        })
        .prefault({}),
    })
    .prefault({}),
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
  databasePath: z.string().default('./data/epass42.db'),
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
  /**
   * Reverse proxies whose `X-Forwarded-*` headers are trusted: a list of
   * IPs/CIDRs, `true` to trust every peer, or `false` to trust none.  The
   * default trusts loopback, where a same-host reverse proxy connects from.
   */
  trustProxy: z.union([z.boolean(), z.array(z.string())]).default(['127.0.0.1', '::1']),
  rateLimit: z
    .object({
      max: z.number().int().min(0).default(120),
      windowMs: z.number().int().min(1000).default(60_000),
    })
    .default({ max: 120, windowMs: 60_000 }),
  smtp: z
    .object({
      url: z.string().optional(),
      from: z.string().default('ePass 42 <no-reply@localhost>'),
    })
    .default({ from: 'ePass 42 <no-reply@localhost>' }),
  adminMnts: z
    .object({
      csca: z.array(z.string()).default([]),
      cvca: z.array(z.string()).default([]),
      dv: z.array(z.string()).default([]),
      dsc: z.array(z.string()).default([]),
    })
    .default({ csca: [], cvca: [], dv: [], dsc: [] }),
  /** Also treat any `mnt_by` entry as an admin MNT. */
  adminIncludeMntBy: z.boolean().default(false),
  oauthProviders: z.array(oauthProviderSchema).default([]),
  csca: cscaSchema.prefault({}),
  cvca: cvcaSchema.prefault({}),
  issuing: z
    .object({
      issuingState: z.string().length(3).default(COUNTRY_ALPHA3),
      issuingAuthority: z.string().default('NIA'),
      personalizationDevice: z.string().default('EPASS42'),
      dg13Policy: z.string().default('utf8-text'),
      /** Document validity, in years, applied to the server-computed expiry. */
      validityYears: z.number().int().min(1).max(30).default(10),
      /**
       * Maximum DG2 (face) byte size.  Default matches card42's LDS1 DG2
       * capacity (16384 B); a larger face is rejected.
       */
      dg2MaxBytes: z.number().int().min(1024).default(16384),
      /**
       * LDS2 applications to emit.  Disabled by default (no LDS2 sections); when
       * enabled the listed roles are emitted as empty applications.  Chip
       * Authentication material is shared with LDS1 through the master file.
       */
      lds2: z
        .object({
          enabled: z.boolean().default(false),
          roles: z
            .array(z.enum(['travel', 'visa', 'biometrics']))
            .default(['travel', 'visa', 'biometrics']),
        })
        .prefault({}),
      /** Default LDS1/LDS2 security mechanisms chosen by the administrator. */
      security: z
        .object({
          /** PACE ECDH-GM profiles (shared; at least one must stay selected). */
          pace: z
            .object({
              ecdhGm3des: z.boolean().default(true),
              ecdhGmAes128: z.boolean().default(true),
            })
            .prefault({}),
          /** Active Authentication (LDS1 only). */
          aa: z
            .object({
              enabled: z.boolean().default(false),
              algorithm: z.enum(['rsaSha1', 'rsaSha256', 'ecdsa']).default('rsaSha1'),
            })
            .prefault({}),
          /** Chip Authentication (shared; forced on when LDS2 is emitted). */
          ca: z
            .object({
              enabled: z.boolean().default(false),
              /** Chip Authentication key id shared by LDS1 and the LDS2 applications. */
              keyId: z.number().int().min(0).max(255).default(1),
            })
            .prefault({}),
          /**
           * Terminal Authentication: personalize a CVCA trust point and advertise
           * `id-TA` so terminals can authenticate (requires an ECDSA CVCA).
           */
          ta: z
            .object({
              enabled: z.boolean().default(false),
              currentDate: z
                .string()
                .regex(/^\d{6}$/)
                .optional(),
              authorization: dvPermissionsSchema.optional(),
            })
            .prefault({}),
        })
        .prefault({}),
    })
    .prefault({}),
  /**
   * dn42 whois used to resolve a client IP to its maintainer(s).  The endpoint
   * `/dsc/jurisdiction` looks up the IP's `mnt-by` to decide whether the
   * requesting maintainer uses its own DSC.
   */
  jurisdiction: z
    .object({
      whois: z.string().default('whois.dn42'),
      whoisPort: z.number().int().min(1).max(65535).default(43),
      whoisTimeoutMs: z.number().int().min(100).default(5000),
      /** How long (ms) an IP→MNT answer is cached before it is re-queried. */
      whoisCacheTtlMs: z
        .number()
        .int()
        .min(1000)
        .default(5 * 60_000),
      /** Maximum cached IP→MNT answers (LRU eviction beyond this). */
      whoisCacheMaxEntries: z.number().int().min(1).default(1024),
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
  /** Explicit TOML path; defaults to `./config.toml` relative to `cwd`. */
  configPath?: string
  cwd?: string
}

/** A raw, unvalidated configuration object (the TOML shape). */
export type RawConfig = Record<string, unknown>

/** Reads the TOML file (an absent file yields an empty configuration). */
function readToml(path: string | undefined, cwd: string): RawConfig {
  if (!path) return {}
  const absolute = resolve(cwd, path)
  if (!existsSync(absolute)) return {}
  return parseToml(readFileSync(absolute, 'utf8')) as RawConfig
}

/** Deep-merges two levels of plain objects; arrays and scalars are replaced. */
export function mergeConfig(base: RawConfig, overlay: RawConfig): RawConfig {
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
      result[key] = mergeConfig(current as RawConfig, value as RawConfig)
    } else {
      result[key] = value
    }
  }
  return result
}

/** Reads a plain object from raw configuration (arrays and null are ignored). */
function rawObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Validates a raw configuration object and applies development defaults. */
export function parseConfig(raw: RawConfig): AppConfig {
  const parsed = configSchema.parse(raw)
  // The shared country codes are the single source of truth for the CSCA SAN
  // locality, the default issuing state and the default CRL distribution point.
  // Explicit nested values still win.
  const rawCsca = rawObject(raw.csca)
  if (rawCsca?.locality === undefined) parsed.csca.locality = parsed.countryAlpha3
  if (rawCsca?.crlDistributionPoints === undefined) {
    parsed.csca.crlDistributionPoints = [`ldap://epass42.local/c=${parsed.countryAlpha2}`]
  }
  const rawIssuing = rawObject(raw.issuing)
  if (rawIssuing?.issuingState === undefined) {
    parsed.issuing.issuingState = parsed.countryAlpha3
  }
  // In development the Nuxt dev server runs on :3001 by default.
  if (parsed.frontendUrl === '' && parsed.env === 'development') {
    parsed.frontendUrl = 'http://localhost:3001'
  }
  if (parsed.env === 'production' && parsed.sessionSecret.startsWith('dev-insecure')) {
    throw new Error('config.toml must set a strong sessionSecret in production')
  }
  return parsed
}

/**
 * Loads and validates the application configuration from `config.toml`
 * (default `./config.toml` relative to `cwd`).
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const cwd = options.cwd ?? process.cwd()
  const configPath = options.configPath ?? 'config.toml'
  return parseConfig(readToml(configPath, cwd))
}
