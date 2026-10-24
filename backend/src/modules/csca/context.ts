/**
 * Shared context and row aliases for the CSCA role services.
 *
 * The CSCA private key is sealed with the envelope KEK and only opened while
 * issuing.
 */
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { crl, cscaKey, dscApplication, dscCert } from '../../db/schema'

export type CscaKeyRow = typeof cscaKey.$inferSelect
export type DscCertRow = typeof dscCert.$inferSelect
export type DscApplicationRow = typeof dscApplication.$inferSelect
export type CrlRow = typeof crl.$inferSelect

/** Collaborators for the CSCA services. */
export interface CscaContext {
  db: Db
  config: AppConfig
  /** Ordered KEKs: index 0 seals new keys, all are tried when opening. */
  keks: Buffer[]
}

/** Adds whole years to a date (UTC). */
export function addYears(date: Date, years: number): Date {
  const out = new Date(date)
  out.setUTCFullYear(out.getUTCFullYear() + years)
  return out
}

/** Adds whole days to a date (UTC). */
export function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}
