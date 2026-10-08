/**
 * AS-level DSC delegation (M4/T4.11, E2).
 *
 * An AS either delegates DSC issuance to the NIA DSC (the default) or uses its
 * own certificate.  The setting is stored in `as_config`; enabling delegation
 * also records the caller as a delegated reviewer in the DSC realm.
 */
import { and, eq } from 'drizzle-orm'

import type { Db } from '../../db/client'
import { asConfig, dscCert } from '../../db/schema'
import { nowIso } from '../../util/time'
import { recordAsAdmin, removeAsAdmin, type AccountRow } from '../auth/authorization'

/** The delegation state of an AS, as exposed to the UI. */
export interface AsDelegation {
  asn: number | null
  activeMnt: string | null
  useNiaDsc: boolean
  hasActiveDsc: boolean
}

/** The AS's own active DSC certificate, or undefined. */
export function activeOwnDsc(db: Db, asn: number) {
  return db
    .select()
    .from(dscCert)
    .where(and(eq(dscCert.asn, asn), eq(dscCert.status, 'active')))
    .get()
}

/** Reads the delegation state for an account's AS. */
export function readAsDelegation(db: Db, account: AccountRow): AsDelegation {
  const asn = account.asn
  if (asn === null) {
    return { asn: null, activeMnt: account.activeMnt, useNiaDsc: true, hasActiveDsc: false }
  }
  const row = db.select().from(asConfig).where(eq(asConfig.asn, asn)).get()
  return {
    asn,
    activeMnt: account.activeMnt,
    // Default (no row) is delegation to the NIA DSC.
    useNiaDsc: row ? row.useNiaDsc : true,
    hasActiveDsc: activeOwnDsc(db, asn) !== undefined,
  }
}

/** Persists the delegation choice and updates the delegated-reviewer record. */
export function setAsDelegation(db: Db, account: AccountRow, useNiaDsc: boolean): AsDelegation {
  const asn = account.asn as number
  db.insert(asConfig)
    .values({
      asn,
      useNiaDsc,
      updatedBy: account.id,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: asConfig.asn,
      set: { useNiaDsc, updatedBy: account.id, updatedAt: nowIso() },
    })
    .run()
  if (account.activeMnt) {
    if (useNiaDsc) recordAsAdmin(db, account.activeMnt, asn)
    else removeAsAdmin(db, account.activeMnt)
  }
  return readAsDelegation(db, account)
}
