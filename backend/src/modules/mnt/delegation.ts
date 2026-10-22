/**
 * Maintainer-level DSC delegation (M4/T4.11, E2).
 *
 * A maintainer either delegates DSC issuance to the NIA DSC (the default) or
 * uses its own certificate.  The setting is stored in `mnt_config`; enabling
 * delegation also records the maintainer as a delegated DSC reviewer.
 */
import { and, eq } from 'drizzle-orm'

import type { Db } from '../../db/client'
import { dscCert, mntConfig } from '../../db/schema'
import { nowIso } from '../../util/time'
import { recordAsAdmin, removeAsAdmin, type AccountRow } from '../auth/authorization'

/** The delegation state of a maintainer, as exposed to the UI. */
export interface MntDelegation {
  mnt: string | null
  useNiaDsc: boolean
  hasActiveDsc: boolean
}

/** The maintainer's own active DSC certificate, or undefined (LDS2 excluded). */
export function activeOwnDsc(db: Db, mnt: string) {
  return db
    .select()
    .from(dscCert)
    .where(
      and(eq(dscCert.mnt, mnt), eq(dscCert.certificateType, 'dsc'), eq(dscCert.status, 'active')),
    )
    .get()
}

/** Reads the delegation state for an account's maintainer. */
export function readMntDelegation(db: Db, account: AccountRow): MntDelegation {
  const mnt = account.activeMnt
  if (mnt === null) {
    return { mnt: null, useNiaDsc: true, hasActiveDsc: false }
  }
  const row = db.select().from(mntConfig).where(eq(mntConfig.mnt, mnt)).get()
  return {
    mnt,
    // Default (no row) is delegation to the NIA DSC.
    useNiaDsc: row ? row.useNiaDsc : true,
    hasActiveDsc: activeOwnDsc(db, mnt) !== undefined,
  }
}

/** Persists the delegation choice and updates the delegated-reviewer record. */
export function setMntDelegation(db: Db, account: AccountRow, useNiaDsc: boolean): MntDelegation {
  const mnt = account.activeMnt as string
  db.insert(mntConfig)
    .values({
      mnt,
      useNiaDsc,
      updatedBy: account.id,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: mntConfig.mnt,
      set: { useNiaDsc, updatedBy: account.id, updatedAt: nowIso() },
    })
    .run()
  if (useNiaDsc) recordAsAdmin(db, mnt)
  else removeAsAdmin(db, mnt)
  return readMntDelegation(db, account)
}
