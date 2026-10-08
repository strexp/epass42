/**
 * Accounts and administrator authorization (M4/T4.5, T4.7).
 *
 * Administrators are maintainers whose MNT is in the realm's configured list
 * (or, optionally, present in the identity's `mnt_by`).
 */
import { and, eq } from 'drizzle-orm'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { account, maintainer } from '../../db/schema'
import { nowIso } from '../../util/time'
import type { Realm } from '@pkd42/shared'
import type { Dn42Identity } from './claims'

export type AccountRow = typeof account.$inferSelect

/** The maintainers listed in the dn42 identity's `mnt_by`, for optional admin checks. */
function mntByFromClaims(rawClaims: string | null): string[] {
  if (!rawClaims) return []
  try {
    const parsed = JSON.parse(rawClaims) as { dn42?: { mnt_by?: unknown } }
    const mntBy = parsed.dn42?.mnt_by
    return Array.isArray(mntBy)
      ? mntBy.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

/** Creates or updates the account for an identity login. */
export function upsertAccount(
  db: Db,
  realm: Realm,
  providerId: number,
  identity: Dn42Identity,
): AccountRow {
  const existing = db
    .select()
    .from(account)
    .where(
      and(
        eq(account.realm, realm),
        eq(account.providerId, providerId),
        eq(account.subject, identity.subject),
      ),
    )
    .get()
  const values = {
    realm,
    providerId,
    subject: identity.subject,
    asn: identity.asn ?? null,
    activeMnt: identity.activeMnt ?? null,
    email: identity.email ?? null,
    name: identity.name ?? identity.preferredUsername ?? null,
    rawClaims: JSON.stringify(identity.raw),
    createdAt: existing?.createdAt ?? nowIso(),
  }
  if (existing) {
    db.update(account).set(values).where(eq(account.id, existing.id)).run()
    return { ...existing, ...values }
  }
  const result = db.insert(account).values(values).run()
  return { ...values, id: Number(result.lastInsertRowid) } as AccountRow
}

/** Loads an account by id. */
export function getAccount(db: Db, id: number): AccountRow | undefined {
  return db.select().from(account).where(eq(account.id, id)).get()
}

/** The set of administrator MNTs for a realm. */
export function adminMnts(db: Db, config: AppConfig, realm: Realm): Set<string> {
  const fromConfig = realm === 'csca' ? config.adminMnts.csca : config.adminMnts.dsc
  const set = new Set(fromConfig)
  const rows = db
    .select()
    .from(maintainer)
    .where(and(eq(maintainer.realm, realm), eq(maintainer.role, 'admin')))
    .all()
  for (const row of rows) set.add(row.mnt)
  return set
}

/** True when the account is an administrator of the realm. */
export function isAdmin(db: Db, config: AppConfig, realm: Realm, row: AccountRow): boolean {
  const admins = adminMnts(db, config, realm)
  if (admins.size === 0) return false
  if (row.activeMnt && admins.has(row.activeMnt)) return true
  if (config.adminIncludeMntBy) {
    for (const mnt of mntByFromClaims(row.rawClaims)) {
      if (admins.has(mnt)) return true
    }
  }
  return false
}
