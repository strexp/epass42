/**
 * Minimal durable job queue (M3 skeleton).
 *
 * Jobs are rows in the `job` table; a worker (added with the CRL/mail
 * scheduling in M6/M8) polls and processes them.
 */
import type { Db } from '../db/client'
import { job } from '../db/schema'
import { nowIso } from '../util/time'

/** Enqueues a job for later processing. */
export function enqueue(db: Db, kind: string, payload?: unknown, runAt: string = nowIso()): number {
  const result = db
    .insert(job)
    .values({
      kind,
      payload: payload === undefined ? null : JSON.stringify(payload),
      runAt,
      status: 'pending',
      attempts: 0,
      createdAt: nowIso(),
    })
    .run()
  return Number(result.lastInsertRowid)
}
