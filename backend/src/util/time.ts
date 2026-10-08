/**
 * Small time helpers.  All persisted timestamps use the canonical
 * `YYYY-MM-DDTHH:MM:SSZ` form.
 */
import { formatIso } from './format'

/** The current time as a canonical ISO string (seconds precision). */
export function nowIso(): string {
  return formatIso(new Date())
}

/** Adds seconds to an ISO timestamp and returns the canonical ISO string. */
export function addSeconds(iso: string, seconds: number): string {
  return formatIso(new Date(new Date(iso).getTime() + seconds * 1000))
}

/** Returns the canonical ISO string for `now + seconds`. */
export function isoInSeconds(seconds: number): string {
  return formatIso(new Date(Date.now() + seconds * 1000))
}

/** True when the ISO timestamp is in the past. */
export function isExpired(iso: string, now = nowIso()): boolean {
  return iso <= now
}
