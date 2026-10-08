import { defineConfig } from 'drizzle-kit'

/** drizzle-kit configuration: SQLite schema in `src/db/schema.ts`. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.PKD42_DB_PATH ?? './data/pkd42.db',
  },
})
