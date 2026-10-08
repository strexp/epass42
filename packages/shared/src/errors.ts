/**
 * Stable, machine-readable error codes shared by the API and the front end.
 *
 * The backend maps these to HTTP statuses; the front end maps them to i18n
 * keys (`error.<code>`).
 */
export const ERROR_CODES = [
  // Generic
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'gone',
  'rate_limited',
  'internal',
  // Validation
  'validation_failed',
  'payload_too_large',
  'unsupported_media_type',
  // Auth
  'oauth_discovery_failed',
  'oauth_state_mismatch',
  'session_expired',
  // CSCA / DSC
  'application_not_found',
  'application_already_reviewed',
  'certificate_not_found',
  'certificate_revoked',
  'csr_invalid',
  'document_type_mismatch',
  'mrz_invalid',
  'document_number_conflict',
  'request_not_found',
  'request_already_consumed',
  'request_not_approved',
  'reveal_not_allowed',
  'token_invalid',
  'token_expired',
  'token_used',
  // PKI
  'profile_violation',
  'signature_invalid',
  'chain_invalid',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** A structured error carrying a stable code. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, status = 400, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}
