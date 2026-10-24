import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e-run/**/*.test.ts'],
    // `better-sqlite3` (used by the backend suite) is happiest in child processes.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
