/**
 * Audit log writer (M3 skeleton, expanded in M13).
 *
 * Records who did what, to which object, from where.  Contents of sensitive
 * payloads are never written here.
 */
import type { Db } from '../db/client'
import { auditLog } from '../db/schema'
import { nowIso } from '../util/time'

/** One audit event. */
export interface AuditEntry {
  actorAccountId?: number | null
  realm?: string | null
  action: string
  targetType?: string | null
  targetId?: string | number | null
  ip?: string | null
  userAgent?: string | null
  detail?: unknown
}

/** Appends an audit entry. */
export function writeAudit(db: Db, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      actorAccountId: entry.actorAccountId ?? null,
      realm: entry.realm ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId:
        entry.targetId === undefined || entry.targetId === null ? null : String(entry.targetId),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
      createdAt: nowIso(),
    })
    .run()
}
