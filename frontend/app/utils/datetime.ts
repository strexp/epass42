/**
 * Display helpers for ISO timestamps.
 *
 * `formatDate` shows the calendar day, `formatDateTime` adds the time of day.
 * Both render the instant in **UTC** (so a value never shifts by a day between
 * viewers) and follow the given locale — US English by default.  See the copy
 * style guide in `i18n/i18n.config.ts`.  A missing value becomes an em dash
 * and an unparseable value is passed through unchanged.
 */

function dateFormat(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
}

function dateTimeFormat(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
}

/** `Oct 13, 2026` (en) / `2026年10月13日` (zh), or `—`/the input when unusable. */
export function formatDate(value: string | null | undefined, locale = 'en'): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat(locale).format(date)
}

/** The locale date and UTC time of day, or `—`/the input when unusable. */
export function formatDateTime(value: string | null | undefined, locale = 'en'): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormat(locale).format(date)
}
