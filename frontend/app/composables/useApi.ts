import { ofetch } from 'ofetch'

/**
 * The API client (T11.3): same-origin by default, cookie credentials included,
 * no retries.  Errors bubble up as FetchError with the backend's JSON body.
 */
export function useApi() {
  const config = useRuntimeConfig()
  const base = (config.public.apiBase as string) || undefined
  return ofetch.create({
    baseURL: base,
    credentials: 'include',
    retry: 0,
    headers: { accept: 'application/json' },
  })
}

/** The API origin (empty when the SPA is served same-origin as the backend). */
export function useApiBase(): string {
  const config = useRuntimeConfig()
  return (config.public.apiBase as string) || ''
}

/** Maps a backend error code to an i18n key, falling back to generic. */
export function errorMessageKey(error: unknown): string {
  const code = (error as { data?: { error?: string } })?.data?.error
  if (code && ERROR_KEYS.has(code)) return `errors.${code}`
  const status = (error as { statusCode?: number; status?: number })?.statusCode
  if (status === 401) return 'errors.unauthorized'
  if (status === 403) return 'errors.forbidden'
  if (status === 404) return 'errors.not_found'
  if (status === 400) return 'errors.validation_failed'
  return 'errors.generic'
}

const ERROR_KEYS = new Set([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'no_security_mechanism',
  'pace_required',
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
  'dv_key_unavailable',
  'no_active_dv',
  'no_dv_available',
  'ta_requires_cvca',
  'signature_invalid',
])
