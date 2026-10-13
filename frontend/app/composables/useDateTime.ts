import { formatDate, formatDateTime } from '~/utils/datetime'

/**
 * Binds the pure helpers in `~/utils/datetime` to the selected UI locale, so
 * dates and times follow the language switch and stay UTC (see the copy style
 * guide in `i18n/i18n.config.ts`).  Call once during setup and reuse the
 * returned functions, including inside table-column renderers.
 */
export function useDateTime(): {
  formatDate: (value: string | null | undefined) => string
  formatDateTime: (value: string | null | undefined) => string
} {
  const { locale } = useI18n()
  return {
    formatDate: (value) => formatDate(value, locale.value),
    formatDateTime: (value) => formatDateTime(value, locale.value),
  }
}
