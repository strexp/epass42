/**
 * Shared context and row aliases for the CVCA role services.
 *
 * The CVCA is the authorization-PKI trust anchor (Doc 9303-12 §3.2) and issues
 * card-verifiable DV certificates.  Its private key is sealed with the envelope
 * KEK and only opened while issuing.
 */
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { cvcaKey, dvApplication, dvCert, terminalCert } from '../../db/schema'

export type CvcaKeyRow = typeof cvcaKey.$inferSelect
export type DvApplicationRow = typeof dvApplication.$inferSelect
export type DvCertRow = typeof dvCert.$inferSelect
export type TerminalCertRow = typeof terminalCert.$inferSelect

/** Collaborators for the CVCA services. */
export interface CvcaContext {
  db: Db
  config: AppConfig
  /** Ordered KEKs: index 0 seals new keys, all are tried when opening. */
  keks: Buffer[]
}

/** Adds whole months to a date (UTC). */
export function addMonths(date: Date, months: number): Date {
  const out = new Date(date)
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

/** Adds whole days to a date (UTC). */
export function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

/**
 * Builds the five-character sequence number of a Certificate Holder Reference:
 * the certifying CA's country code followed by three digits (Doc 9303-12
 * §7.2.2.2 c).
 */
export function sequenceNumber(country: string, index: number): string {
  return `${country}${String(index % 1000).padStart(3, '0')}`
}
