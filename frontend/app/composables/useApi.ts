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
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'no_security_mechanism',
  'pace_required',
  'request_already_consumed',
  'reveal_not_allowed',
  'document_number_conflict',
  'no_active_dsc',
  'no_private_key',
  'private_key_consumed',
  'dg2_too_large',
  'active_passport_exists',
  'passport_not_active',
])
