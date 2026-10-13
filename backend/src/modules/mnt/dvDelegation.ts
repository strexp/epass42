/**
 * Maintainer-level DV delegation (M18), mirroring the CSCA DSC delegation.
 *
 * A maintainer either uses the CVCA-issued default (system) DV certificate for
 * its terminals (the default) or one of its own approved DV certificates.  The
 * choice is stored in `mnt_config` and will be consumed by the Terminal
 * certificate issuance flow.
 */
import { and, eq } from 'drizzle-orm'

import type { Db } from '../../db/client'
import { dvCert, mntConfig } from '../../db/schema'
import { nowIso } from '../../util/time'
import type { AccountRow } from '../auth/authorization'

/** The DV delegation state of a maintainer, as exposed to the UI. */
export interface DvDelegation {
  mnt: string | null
  useNiaDv: boolean
  hasActiveDv: boolean
}

/** The maintainer's own active DV certificate, or undefined. */
export function activeOwnDv(db: Db, mnt: string) {
  return db
    .select()
    .from(dvCert)
    .where(and(eq(dvCert.mnt, mnt), eq(dvCert.status, 'active')))
    .get()
}

/** Reads the DV delegation state for an account's maintainer. */
export function readDvDelegation(db: Db, account: AccountRow): DvDelegation {
  const mnt = account.activeMnt
  if (mnt === null) {
    return { mnt: null, useNiaDv: true, hasActiveDv: false }
  }
  const row = db.select().from(mntConfig).where(eq(mntConfig.mnt, mnt)).get()
  return {
    mnt,
    // Default (no row) is delegation to the CVCA's default DV.
    useNiaDv: row ? row.useNiaDv : true,
    hasActiveDv: activeOwnDv(db, mnt) !== undefined,
  }
}

/** Persists the DV delegation choice, preserving the DSC delegation. */
export function setDvDelegation(db: Db, account: AccountRow, useNiaDv: boolean): DvDelegation {
  const mnt = account.activeMnt as string
  db.insert(mntConfig)
    .values({
      mnt,
      useNiaDv,
      updatedBy: account.id,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: mntConfig.mnt,
      set: { useNiaDv, updatedBy: account.id, updatedAt: nowIso() },
    })
    .run()
  return readDvDelegation(db, account)
}

/**
 * True when the maintainer delegates terminal certificate signing to the
 * CVCA's default DV.  A missing row means the default (delegated).
 */
export function mntDelegatesToDefaultDv(db: Db, mnt: string): boolean {
  const row = db.select().from(mntConfig).where(eq(mntConfig.mnt, mnt)).get()
  return row ? row.useNiaDv : true
}
