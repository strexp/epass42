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
  'no_security_mechanism',
  'pace_required',
  // CSCA / DSC
  'application_not_found',
  'application_already_reviewed',
  'certificate_not_found',
  'mrz_invalid',
  'document_number_conflict',
  'dsc_document_type_mismatch',
  'no_active_dsc',
  'ml_signer_missing',
  'ml_signer_expired',
  'csca_missing',
  'csca_expired',
  'nia_dsc_expired',
  'dsc_expired',
  'nia_dv_expired',
  'cvca_expired',
  'certificate_not_active',
  'no_private_key',
  'private_key_consumed',
  'dg2_too_large',
  'passport_not_active',
  'request_not_found',
  'request_already_consumed',
  'request_not_approved',
  'reveal_not_allowed',
  'token_invalid',
  'token_expired',
  // CVCA / Terminal Authentication
  'dv_key_unavailable',
  'no_active_dv',
  'no_dv_available',
  'ta_requires_cvca',
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
