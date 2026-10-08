/**
 * SQLite connection (better-sqlite3) wired into Drizzle.
 *
 * WAL journalling, foreign keys and a busy timeout are enabled on open, as
 * required by M3/T3.3.
 */
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import * as schema from './schema'

/** A Drizzle database bound to the full schema. */
export type Db = BetterSQLite3Database<typeof schema>

/** The raw better-sqlite3 handle and the Drizzle wrapper. */
export interface DbHandle {
  db: Db
  sqlite: Database.Database
}

/** Opens (or creates) a SQLite database with the project pragmas. */
export function openDatabase(path: string): DbHandle {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

export { schema }
