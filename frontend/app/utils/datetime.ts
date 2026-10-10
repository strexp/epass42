/**
 * Small display helper for ISO timestamps.
 *
 * `DateTimeText.vue` is preferred inside templates (it renders Naive UI's
 * `NTime`); this is for places that need a plain string, such as the timeline
 * item `time` prop.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
