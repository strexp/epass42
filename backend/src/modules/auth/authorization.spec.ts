import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { makeTestConfig } from '../../test-support'
import { openDatabase, type Db } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { account, asConfig } from '../../db/schema'
import {
  asAdminAsns,
  canManageSettings,
  canReview,
  dscScope,
  recordAsAdmin,
  type AccountRow,
} from './authorization'
import { nowIso } from '../../util/time'

function makeDb(): Db {
  const handle = openDatabase(':memory:')
  runMigrations(handle)
  return handle.db
}

function insertAccount(
  db: Db,
  values: { subject: string; asn: number | null; activeMnt: string | null },
): AccountRow {
  const result = db
    .insert(account)
    .values({
      realm: 'dsc',
      providerId: null,
      subject: values.subject,
      asn: values.asn,
      activeMnt: values.activeMnt,
      rawClaims: JSON.stringify({ dn42: { mnt_by: [values.activeMnt] } }),
      createdAt: nowIso(),
    })
    .run()
  return db
    .select()
    .from(account)
    .where(eq(account.id, Number(result.lastInsertRowid)))
    .get() as AccountRow
}

describe('DSC delegated AS review scope', () => {
  const config = makeTestConfig({ PKD42_DSC_ADMIN_MNTS: 'NIA-DSC-MNT' })

  it('treats a configured MNT as a global NIA administrator', () => {
    const db = makeDb()
    const nia = insertAccount(db, { subject: 'nia', asn: 4242420000, activeMnt: 'NIA-DSC-MNT' })
    expect(dscScope(db, config, nia)).toEqual({ kind: 'nia' })
    expect(canManageSettings({ kind: 'nia' })).toBe(true)
  })

  it('grants an AS reviewer scope only when the AS delegates to NIA DSC', () => {
    const db = makeDb()
    const asUser = insertAccount(db, { subject: 'as1', asn: 4242420001, activeMnt: 'AS1-MNT' })
    // Not yet recorded as an AS admin.
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'none' })

    // The default (no as_config row) is delegation to the NIA DSC.
    recordAsAdmin(db, 'AS1-MNT', 4242420001)
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'as', asn: 4242420001 })

    // Opting out of delegation removes the scope.
    db.insert(asConfig).values({ asn: 4242420001, useNiaDsc: false, updatedAt: nowIso() }).run()
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'none' })

    // Opting back in restores it.
    db.update(asConfig).set({ useNiaDsc: true }).run()
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'as', asn: 4242420001 })
    expect(asAdminAsns(db, 'AS1-MNT')).toEqual([4242420001])
    expect(canManageSettings({ kind: 'as', asn: 4242420001 })).toBe(false)
  })

  it('scopes visibility to the reviewer AS and to NIA-signed requests', () => {
    const scope = { kind: 'as', asn: 4242420001 } as const
    expect(canReview(scope, { asn: 4242420001, dscSelection: 'nia' })).toBe(true)
    // Another AS is not visible.
    expect(canReview(scope, { asn: 4242420002, dscSelection: 'nia' })).toBe(false)
    // A request signed by the AS's own DSC is out of scope.
    expect(canReview(scope, { asn: 4242420001, dscSelection: 'owned' })).toBe(false)

    const nia = { kind: 'nia' } as const
    expect(canReview(nia, { asn: 4242420002, dscSelection: 'owned' })).toBe(true)
    expect(canReview({ kind: 'none' }, { asn: 4242420001, dscSelection: 'nia' })).toBe(false)
  })
})
