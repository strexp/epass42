/**
 * Drizzle SQLite schema (TODO.md Appendix C).
 *
 * All timestamps are stored as `YYYY-MM-DDTHH:MM:SSZ` text.  Private key
 * material is never stored in clear text: `key_ref` / `private_key_pem_enc`
 * hold references to envelope-encrypted blobs.
 */
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

export const oauthProvider = sqliteTable(
  'oauth_provider',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    realm: text('realm', { enum: ['csca', 'dsc'] }).notNull(),
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    secretRef: text('secret_ref'),
    scopes: text('scopes'),
    claimMap: text('claim_map'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [uniqueIndex('ux_oauth_provider').on(table.realm, table.issuer, table.clientId)],
)

export const account = sqliteTable(
  'account',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    realm: text('realm').notNull(),
    providerId: integer('provider_id').references(() => oauthProvider.id),
    subject: text('subject').notNull(),
    asn: integer('asn'),
    activeMnt: text('active_mnt'),
    email: text('email'),
    name: text('name'),
    rawClaims: text('raw_claims'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('ux_account').on(table.realm, table.providerId, table.subject)],
)

export const session = sqliteTable(
  'session',
  {
    /** SHA-256 hash of the session token (never the token itself). */
    id: text('id').primaryKey(),
    realm: text('realm').notNull(),
    accountId: integer('account_id').references(() => account.id),
    data: text('data'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('ix_session_expires').on(table.expiresAt)],
)

export const maintainer = sqliteTable(
  'maintainer',
  {
    mnt: text('mnt').notNull(),
    realm: text('realm').notNull(),
    role: text('role').notNull(),
    /** For `role='as-admin'`, the delegated AS this maintainer may review. */
    asn: integer('asn'),
    note: text('note'),
  },
  (table) => [primaryKey({ columns: [table.mnt, table.realm, table.role] })],
)

/**
 * Short-lived OIDC authorization-code flow state (state, nonce, PKCE verifier).
 * Not part of Appendix C but required to complete the code grant.
 */
export const oauthFlow = sqliteTable(
  'oauth_flow',
  {
    state: text('state').primaryKey(),
    realm: text('realm').notNull(),
    providerId: integer('provider_id').notNull(),
    nonce: text('nonce').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    redirectTo: text('redirect_to'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [index('ix_oauth_flow_expires').on(table.expiresAt)],
)

/* ------------------------------------------------------------------ *
 * CSCA
 * ------------------------------------------------------------------ */

export const cscaKey = sqliteTable('csca_key', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serial: text('serial').notNull().unique(),
  subjectDn: text('subject_dn').notNull(),
  keyAlgorithm: text('key_algorithm').notNull(),
  notBefore: text('not_before'),
  notAfter: text('not_after'),
  certPem: text('cert_pem').notNull(),
  keyRef: text('key_ref').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull(),
})

export const dscApplication = sqliteTable('dsc_application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  asn: integer('asn'),
  mnt: text('mnt'),
  applicantAccountId: integer('applicant_account_id').references(() => account.id),
  keyMode: text('key_mode').notNull(),
  subjectCn: text('subject_cn'),
  csrPem: text('csr_pem'),
  publicKeyPem: text('public_key_pem'),
  documentType: text('document_type'),
  validityDays: integer('validity_days'),
  issuancePolicy: text('issuance_policy'),
  applicationUrl: text('application_url'),
  notes: text('notes'),
  status: text('status').notNull().default('submitted'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  rejectReason: text('reject_reason'),
  createdAt: text('created_at').notNull(),
})

export const dscCert = sqliteTable('dsc_cert', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cscaKeyId: integer('csca_key_id').references(() => cscaKey.id),
  serial: text('serial').notNull().unique(),
  subjectDn: text('subject_dn').notNull(),
  asn: integer('asn'),
  mnt: text('mnt'),
  source: text('source').notNull(),
  certPem: text('cert_pem').notNull(),
  keyRef: text('key_ref'),
  privateKeyPemEnc: text('private_key_pem_enc'),
  issuancePolicy: text('issuance_policy'),
  applicationUrl: text('application_url'),
  status: text('status').notNull().default('active'),
  notBefore: text('not_before'),
  notAfter: text('not_after'),
  revokedAt: text('revoked_at'),
  revokeReason: text('revoke_reason'),
  createdAt: text('created_at').notNull(),
})

/* ------------------------------------------------------------------ *
 * CRL / Master List
 * ------------------------------------------------------------------ */

export const crl = sqliteTable('crl', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cscaKeyId: integer('csca_key_id').references(() => cscaKey.id),
  crlNumber: integer('crl_number').notNull(),
  thisUpdate: text('this_update').notNull(),
  nextUpdate: text('next_update').notNull(),
  der: blob('der', { mode: 'buffer' }).notNull(),
  published: integer('published', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
})

export const masterList = sqliteTable('master_list', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  signerDscId: integer('signer_dsc_id'),
  der: blob('der', { mode: 'buffer' }).notNull(),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull(),
})

/* ------------------------------------------------------------------ *
 * DSC signing
 * ------------------------------------------------------------------ */

export const signRequest = sqliteTable('sign_request', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  referenceHash: text('reference_hash').notNull().unique(),
  requesterAccountId: integer('requester_account_id').references(() => account.id),
  asn: integer('asn'),
  ip: text('ip'),
  ipAsn: integer('ip_asn'),
  dscSelection: text('dsc_selection').notNull(),
  dscCertId: integer('dsc_cert_id').references(() => dscCert.id),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().default('submitted'),
  deliveryMode: text('delivery_mode', { enum: ['applicant', 'reviewer'] })
    .notNull()
    .default('applicant'),
  deliveryOverride: integer('delivery_override', { mode: 'boolean' }).notNull().default(false),
  profileOverrides: text('profile_overrides'),
  resultArtifactId: integer('result_artifact_id'),
  email: text('email'),
  mailTokenHash: text('mail_token_hash'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  releasedTo: integer('released_to'),
  consumedAt: text('consumed_at'),
  consumedBy: integer('consumed_by'),
  consumedChannel: text('consumed_channel'),
  regeneratedFrom: integer('regenerated_from'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),
})

export const artifact = sqliteTable('artifact', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  path: text('path').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size'),
  enc: integer('enc', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
})

/* ------------------------------------------------------------------ *
 * AS jurisdiction / settings
 * ------------------------------------------------------------------ */

export const asConfig = sqliteTable('as_config', {
  asn: integer('asn').primaryKey(),
  useNiaDsc: integer('use_nia_dsc', { mode: 'boolean' }).notNull().default(false),
  updatedBy: integer('updated_by'),
  updatedAt: text('updated_at').notNull(),
})

export const systemSetting = sqliteTable('system_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedBy: integer('updated_by').references(() => account.id),
  updatedAt: text('updated_at').notNull(),
})

export const issuingProfile = sqliteTable('issuing_profile', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  issuingState: text('issuing_state').notNull().default('UDN'),
  issuingAuthority: text('issuing_authority'),
  personalizationDevice: text('personalization_device'),
  dg13Policy: text('dg13_policy'),
  endorsementsJson: text('endorsements_json'),
  defaultsJson: text('defaults_json'),
  updatedBy: integer('updated_by').references(() => account.id),
  updatedAt: text('updated_at').notNull(),
})

/* ------------------------------------------------------------------ *
 * Operations
 * ------------------------------------------------------------------ */

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorAccountId: integer('actor_account_id').references(() => account.id),
    realm: text('realm'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    detail: text('detail'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('ix_audit_created').on(table.createdAt)],
)

export const mailToken = sqliteTable('mail_token', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull(),
  purpose: text('purpose').notNull(),
  signRequestId: integer('sign_request_id'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

export const revealToken = sqliteTable('reveal_token', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull(),
  kind: text('kind', { enum: ['confirm', 'consume'] }).notNull(),
  signRequestId: integer('sign_request_id').references(() => signRequest.id),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

export const job = sqliteTable('job', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  payload: text('payload'),
  runAt: text('run_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  status: text('status').notNull().default('pending'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
})
