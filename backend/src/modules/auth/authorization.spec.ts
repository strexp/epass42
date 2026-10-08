import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

import { makeTestConfig } from '../../test-support'
import { openDatabase, type Db } from '../../db/client'
import { runMigrations } from '../../db/migrate'
import { account, mntConfig } from '../../db/schema'
import {
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

function insertAccount(db: Db, values: { subject: string; activeMnt: string | null }): AccountRow {
  const result = db
    .insert(account)
    .values({
      realm: 'dsc',
      providerId: null,
      subject: values.subject,
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

describe('DSC delegated maintainer review scope', () => {
  const config = makeTestConfig({ adminMnts: { dsc: ['NIA-DSC-MNT'] } })

  it('treats a configured MNT as a global NIA administrator', () => {
    const db = makeDb()
    const nia = insertAccount(db, { subject: 'nia', activeMnt: 'NIA-DSC-MNT' })
    expect(dscScope(db, config, nia)).toEqual({ kind: 'nia' })
    expect(canManageSettings({ kind: 'nia' })).toBe(true)
  })

  it('grants a reviewer scope only when the maintainer delegates to NIA DSC', () => {
    const db = makeDb()
    const asUser = insertAccount(db, { subject: 'as1', activeMnt: 'AS1-MNT' })
    // Not yet recorded as a delegated reviewer.
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'none' })

    // The default (no mnt_config row) is delegation to the NIA DSC.
    recordAsAdmin(db, 'AS1-MNT')
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'mnt', mnt: 'AS1-MNT' })

    // Opting out of delegation removes the scope.
    db.insert(mntConfig).values({ mnt: 'AS1-MNT', useNiaDsc: false, updatedAt: nowIso() }).run()
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'none' })

    // Opting back in restores it.
    db.update(mntConfig).set({ useNiaDsc: true }).run()
    expect(dscScope(db, config, asUser)).toEqual({ kind: 'mnt', mnt: 'AS1-MNT' })
    expect(canManageSettings({ kind: 'mnt', mnt: 'AS1-MNT' })).toBe(false)
  })

  it('scopes visibility to the reviewer maintainer and to NIA-signed requests', () => {
    const scope = { kind: 'mnt', mnt: 'AS1-MNT' } as const
    expect(canReview(scope, { mnt: 'AS1-MNT', dscSelection: 'nia' })).toBe(true)
    // A canonical multi-maintainer set matches when any member matches.
    expect(canReview(scope, { mnt: 'OTHER-MNT,AS1-MNT', dscSelection: 'nia' })).toBe(true)
    // Another maintainer is not visible.
    expect(canReview(scope, { mnt: 'AS2-MNT', dscSelection: 'nia' })).toBe(false)
    // A request signed by the maintainer's own DSC is out of scope.
    expect(canReview(scope, { mnt: 'AS1-MNT', dscSelection: 'owned' })).toBe(false)

    const nia = { kind: 'nia' } as const
    expect(canReview(nia, { mnt: 'AS2-MNT', dscSelection: 'owned' })).toBe(true)
    expect(canReview({ kind: 'none' }, { mnt: 'AS1-MNT', dscSelection: 'nia' })).toBe(false)
  })
})
