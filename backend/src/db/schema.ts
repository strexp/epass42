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
    realm: text('realm', { enum: ['csca', 'cvca', 'dv', 'dsc'] }).notNull(),
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
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
  mnt: text('mnt'),
  applicantAccountId: integer('applicant_account_id').references(() => account.id),
  ip: text('ip'),
  keyMode: text('key_mode').notNull(),
  subjectCn: text('subject_cn'),
  /** Applicant-chosen organization (O) and organizational unit (OU). */
  subjectO: text('subject_o'),
  subjectOu: text('subject_ou'),
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
  /** The DSC certificate issued on approval (for the one-time key export). */
  dscCertId: integer('dsc_cert_id').references(() => dscCert.id),
  createdAt: text('created_at').notNull(),
})

export const dscCert = sqliteTable('dsc_cert', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cscaKeyId: integer('csca_key_id').references(() => cscaKey.id),
  serial: text('serial').notNull().unique(),
  subjectDn: text('subject_dn').notNull(),
  mnt: text('mnt'),
  source: text('source').notNull(),
  certPem: text('cert_pem').notNull(),
  keyRef: text('key_ref'),
  /** Stored key algorithm/curve of the subject key (e.g. `ECDSA-P256`). */
  keyAlgorithm: text('key_algorithm'),
  /** `remote_generated` (system key) or `user_uploaded` (no stored key). */
  keyMode: text('key_mode'),
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
 * CVCA (LDS2 authorization PKI, Doc 9303-12 §7.2)
 * ------------------------------------------------------------------ */

export const cvcaKey = sqliteTable('cvca_key', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /**
   * The 16-character Certificate Holder Reference (CHR).  Not unique: a CVCA
   * link certificate and the self-signed root it chains to certify the same
   * key, so they share a CHR.  The DER fingerprint is the unique identity.
   */
  holderReference: text('holder_reference').notNull(),
  /** SHA-256 fingerprint of the DER certificate (unique per certificate). */
  fingerprintSha256: text('fingerprint_sha256').notNull().unique(),
  /** The Certification Authority Reference (CAR) that signed this key. */
  authorityReference: text('authority_reference').notNull(),
  subjectCn: text('subject_cn'),
  keyAlgorithm: text('key_algorithm').notNull(),
  /** The DER-encoded card-verifiable certificate (`7F21`). */
  certDer: blob('cert_der', { mode: 'buffer' }).notNull(),
  keyRef: text('key_ref').notNull(),
  /** `current`, `link` or `retired`. */
  status: text('status').notNull().default('current'),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  notBefore: text('not_before'),
  notAfter: text('not_after'),
  createdAt: text('created_at').notNull(),
})

export const dvApplication = sqliteTable('dv_application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mnt: text('mnt'),
  applicantAccountId: integer('applicant_account_id').references(() => account.id),
  ip: text('ip'),
  keyMode: text('key_mode').notNull(),
  subjectCn: text('subject_cn'),
  holderMnemonic: text('holder_mnemonic'),
  csrPem: text('csr_pem'),
  publicKeyPem: text('public_key_pem'),
  /** The requested DV trust class: `domestic` or `foreign`. */
  dvClass: text('dv_class').notNull().default('domestic'),
  /** The requested LDS2 read/write permissions (JSON). */
  permissionsJson: text('permissions_json'),
  validityDays: integer('validity_days'),
  applicationUrl: text('application_url'),
  notes: text('notes'),
  status: text('status').notNull().default('submitted'),
  /** The administrator's permission override applied at approval (JSON). */
  overridePermissionsJson: text('override_permissions_json'),
  /** The administrator's DV-class override applied at approval. */
  overrideDvClass: text('override_dv_class'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  rejectReason: text('reject_reason'),
  /** The DV certificate issued on approval (for the one-time key export). */
  dvCertId: integer('dv_cert_id').references(() => dvCert.id),
  createdAt: text('created_at').notNull(),
})

export const dvCert = sqliteTable('dv_cert', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cvcaKeyId: integer('cvca_key_id').references(() => cvcaKey.id),
  /** The 16-character Certificate Holder Reference (CHR), unique per DV. */
  holderReference: text('holder_reference').notNull().unique(),
  authorityReference: text('authority_reference').notNull(),
  subjectCn: text('subject_cn'),
  mnt: text('mnt'),
  source: text('source').notNull(),
  /** The DER-encoded card-verifiable certificate (`7F21`). */
  certDer: blob('cert_der', { mode: 'buffer' }).notNull(),
  keyRef: text('key_ref'),
  /** `remote_generated` (system key) or `user_uploaded` (no stored key). */
  keyMode: text('key_mode'),
  /** The DV trust class: `domestic` or `foreign`. */
  dvClass: text('dv_class').notNull().default('domestic'),
  /** The granted LDS2 read/write permissions (JSON). */
  permissionsJson: text('permissions_json'),
  applicationUrl: text('application_url'),
  status: text('status').notNull().default('active'),
  notBefore: text('not_before'),
  notAfter: text('not_after'),
  createdAt: text('created_at').notNull(),
})

/**
 * Terminal (Inspection System) certificates issued by a DV for Terminal
 * Authentication (Doc 9303-11 §7.1).  Signed by the DV certificate's key.
 */
export const terminalCert = sqliteTable('terminal_cert', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dvCertId: integer('dv_cert_id').references(() => dvCert.id),
  /** The 16-character Certificate Holder Reference (CHR), unique per terminal. */
  holderReference: text('holder_reference').notNull().unique(),
  authorityReference: text('authority_reference').notNull(),
  subjectCn: text('subject_cn'),
  mnt: text('mnt'),
  source: text('source').notNull(),
  /** The DER-encoded card-verifiable certificate (`7F21`). */
  certDer: blob('cert_der', { mode: 'buffer' }).notNull(),
  keyRef: text('key_ref'),
  keyMode: text('key_mode'),
  permissionsJson: text('permissions_json'),
  status: text('status').notNull().default('active'),
  notBefore: text('not_before'),
  notAfter: text('not_after'),
  createdAt: text('created_at').notNull(),
})

/**
 * Terminal (Inspection System) certificate applications (M18): a maintainer
 * requests a terminal certificate, a CVCA administrator reviews it, and the
 * resolved Document Verifier issues it.  Terminal applications have no DV
 * delegation: the signing DV follows the maintainer's existing setting.
 */
export const terminalApplication = sqliteTable('terminal_application', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mnt: text('mnt'),
  applicantAccountId: integer('applicant_account_id').references(() => account.id),
  ip: text('ip'),
  keyMode: text('key_mode').notNull(),
  subjectCn: text('subject_cn'),
  holderMnemonic: text('holder_mnemonic'),
  csrPem: text('csr_pem'),
  publicKeyPem: text('public_key_pem'),
  /** The requested LDS2 read/write permissions (JSON). */
  permissionsJson: text('permissions_json'),
  validityDays: integer('validity_days'),
  notes: text('notes'),
  status: text('status').notNull().default('submitted'),
  /** The administrator's permission override applied at approval (JSON). */
  overridePermissionsJson: text('override_permissions_json'),
  /** The terminal certificate issued on approval. */
  terminalCertId: integer('terminal_cert_id').references(() => terminalCert.id),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  rejectReason: text('reject_reason'),
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
  /**
   * The opaque, high-entropy public identifier of a request.  It doubles as the
   * anonymous capability (status lookup and one-time claim) and replaces the
   * former sequential integer id everywhere in the API and UI.
   */
  reference: text('reference').primaryKey(),
  requesterAccountId: integer('requester_account_id').references(() => account.id),
  /** Canonical (sorted, comma-joined) maintainers of the requesting IP. */
  mnt: text('mnt'),
  ip: text('ip'),
  dscSelection: text('dsc_selection').notNull(),
  dscCertId: integer('dsc_cert_id').references(() => dscCert.id),
  payloadJson: text('payload_json').notNull(),
  status: text('status').notNull().default('submitted'),
  deliveryMode: text('delivery_mode', { enum: ['applicant', 'reviewer'] })
    .notNull()
    .default('applicant'),
  profileOverrides: text('profile_overrides'),
  resultArtifactId: text('result_artifact_id').references(() => artifact.id),
  email: text('email'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: text('reviewed_at'),
  rejectReason: text('reject_reason'),
  consumedAt: text('consumed_at'),
  consumedBy: integer('consumed_by'),
  consumedChannel: text('consumed_channel'),
  regeneratedFrom: text('regenerated_from'),
  /** Set when the applicant revokes the produced (active) passport. */
  revokedAt: text('revoked_at'),
  revokeReason: text('revoke_reason'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at'),
})

export const artifact = sqliteTable('artifact', {
  /** An opaque internal identifier (never a sequential integer). */
  id: text('id').primaryKey(),
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

export const mntConfig = sqliteTable('mnt_config', {
  mnt: text('mnt').primaryKey(),
  /** CSCA delegation: the maintainer delegates DSC signing to the NIA DSC. */
  useNiaDsc: integer('use_nia_dsc', { mode: 'boolean' }).notNull().default(true),
  /** CVCA delegation: the maintainer uses the CVCA's default (system) DV. */
  useNiaDv: integer('use_nia_dv', { mode: 'boolean' }).notNull().default(true),
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
  signRequestReference: text('sign_request_reference'),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})

export const revealToken = sqliteTable('reveal_token', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull(),
  kind: text('kind', { enum: ['confirm', 'consume'] }).notNull(),
  signRequestReference: text('sign_request_reference').references(() => signRequest.reference),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
})
