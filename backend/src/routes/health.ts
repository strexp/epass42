/**
 * Health and readiness endpoints (M3/T3.7).
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { DbHandle } from '../db/client'

/** Registers `/healthz` (liveness) and `/readyz` (readiness). */
export function registerHealthRoutes(app: FastifyInstance, handle: DbHandle): void {
  app.get('/healthz', async () => ({ status: 'ok' }))

  app.get(
    '/readyz',
    {
      schema: {
        response: {
          200: z.object({ status: z.string(), database: z.string() }),
          503: z.object({ status: z.string(), database: z.string() }),
        },
      },
    },
    async (_request, reply) => {
      try {
        handle.sqlite.prepare('SELECT 1').get()
        return { status: 'ok', database: 'ok' }
      } catch (error) {
        return reply.code(503).send({ status: 'unavailable', database: String(error) })
      }
    },
  )
}
