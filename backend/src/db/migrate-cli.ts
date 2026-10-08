/**
 * CLI wrapper for applying Drizzle migrations (`pnpm --filter @pkd42/backend db:migrate`).
 */
import { loadConfig } from '../config'
import { openDatabase } from './client'
import { runMigrations } from './migrate'

const config = loadConfig()
const handle = openDatabase(config.databasePath)
runMigrations(handle)
handle.sqlite.close()
console.log(`migrations applied to ${config.databasePath}`)
