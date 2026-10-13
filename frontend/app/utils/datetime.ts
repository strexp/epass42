/**
 * Small display helpers for ISO timestamps.
 *
 * `formatDate` shows the calendar day only (`YYYY-MM-DD`); `formatDateTime`
 * adds the locale time of day.  `DateTimeText.vue` is the usual entry point
 * inside templates; these are for places that need a plain string, such as the
 * timeline item `time` prop or a table cell renderer.
 */

/** `YYYY-MM-DD` for an ISO timestamp (UTC day), or `—`/the input when unusable. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}

/** Locale date and time of day, or `—`/the input when unusable. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
