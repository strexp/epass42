/**
 * MRZ date helpers.
 *
 * ICAO Doc 9303-3 stores dates in the machine-readable zone as `YYMMDD`; the
 * century is not recorded, so a date of birth is read as `19YY` when `YY` is
 * greater than the current two-digit year and as `20YY` otherwise.  Some data
 * groups (e.g. DG16 date of recording) use the full eight-digit `CCYYMMDD`.
 *
 * The functions below bridge those compact strings and the local timestamps
 * used by Naive UI's `NDatePicker`, and are kept free of any Vue/UI dependency
 * so they can be unit-tested in isolation.
 */

/** Formats a date component with two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Number of days in a month (1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Builds a local-midnight timestamp, or `null` when the parts are not a date. */
function buildTimestamp(year: number, month: number, day: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  const date = new Date(0)
  date.setHours(0, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  return date.getTime()
}

/** Whether every character of `value` is a digit and the length matches. */
function isDigitString(value: string, length: number): boolean {
  return value.length === length && /^\d+$/.test(value)
}

/**
 * Converts a compact MRZ date to a local timestamp.
 *
 * @param value  `YYMMDD` (six digits) or `CCYYMMDD` (eight digits).
 * @param digits `6` for the MRZ form, `8` for a full-year form.
 * @returns the local-midnight timestamp, or `null` when invalid.
 */
export function mrzToTimestamp(value: string, digits: 6 | 8 = 6): number | null {
  if (digits === 6) {
    if (!isDigitString(value, 6)) return null
    const yy = Number(value.slice(0, 2))
    const year = yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy
    return buildTimestamp(year, Number(value.slice(2, 4)), Number(value.slice(4, 6)))
  }
  if (!isDigitString(value, 8)) return null
  return buildTimestamp(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)),
    Number(value.slice(6, 8)),
  )
}

/**
 * Converts a timestamp to a compact MRZ date string.
 *
 * @returns the `YYMMDD`/`CCYYMMDD` string, or `''` when `timestamp` is null.
 */
export function timestampToMrz(timestamp: number | null, digits: 6 | 8 = 6): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  if (digits === 6) return `${pad2(date.getFullYear() % 100)}${month}${day}`
  return `${String(date.getFullYear()).padStart(4, '0')}${month}${day}`
}

/**
 * Renders a compact MRZ date for display as an ISO date (`YYYY-MM-DD`).
 *
 * @returns the display date, or `''` when `value` is empty or invalid.
 */
export function formatMrzDate(value: string, digits: 6 | 8 = 6): string {
  const timestamp = mrzToTimestamp(value, digits)
  if (timestamp === null) return ''
  const date = new Date(timestamp)
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
