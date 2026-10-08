import { defineConfig } from 'drizzle-kit'

import { loadConfig } from './src/config'

/** drizzle-kit configuration: SQLite schema in `src/db/schema.ts`. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: loadConfig().databasePath,
  },
})
