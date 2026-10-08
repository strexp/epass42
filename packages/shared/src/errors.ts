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
  'internal',
  // Validation
  'validation_failed',
  // CSCA / DSC
  'application_not_found',
  'application_already_reviewed',
  'certificate_not_found',
  'mrz_invalid',
  'document_number_conflict',
  'no_active_dsc',
  'no_private_key',
  'private_key_consumed',
  'dg2_too_large',
  'request_not_found',
  'request_already_consumed',
  'request_not_approved',
  'reveal_not_allowed',
  'token_invalid',
  'token_expired',
  // PKI
  'signature_invalid',
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
