/**
 * Small display helper for ISO timestamps.
 *
 * Dates are shown as `YYYY-MM-DD` (no time of day).  `DateTimeText.vue` is the
 * usual entry point inside templates; this is for places that need a plain
 * string, such as the timeline item `time` prop or a table cell renderer.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10)
}
