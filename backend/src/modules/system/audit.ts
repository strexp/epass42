/**
 * Audit log viewing (M13/T13.3): a realm's administrators may read the audit
 * trail of their realm.  Entries are written by `writeAudit` throughout.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, like } from 'drizzle-orm'
import { z } from 'zod'

import { realmSchema } from '../../config'
import type { Db } from '../../db/client'
import { account, auditLog } from '../../db/schema'
import { realmEnabled, requireAdmin, type AuthContext } from '../auth/middleware'

/** Registers `GET /:realm/audit` (realm administrators only). */
export function registerAuditRoutes(app: FastifyInstance, deps: AuthContext): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.get(
    '/:realm/audit',
    {
      schema: {
        params: z.object({ realm: realmSchema }),
        querystring: z.object({
          action: z.string().max(120).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
      preHandler: requireAdmin(deps),
    },
    async (request, reply) => {
      const realm = request.params.realm
      if (!realmEnabled(deps.config, realm)) return reply.code(404).send({ error: 'not_found' })
      const all = listAudit(db, realm, request.query.action)
      const page = all.slice(request.query.offset, request.query.offset + request.query.limit)
      return {
        total: all.length,
        items: page.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          actor: actorName(db, row.actorAccountId),
          actorMnt: actorMnt(db, row.actorAccountId),
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          ip: row.ip,
          userAgent: row.userAgent,
          detail: parseDetail(row.detail),
        })),
      }
    },
  )
}

function listAudit(db: Db, realm: string, action?: string) {
  const where = action
    ? and(eq(auditLog.realm, realm), like(auditLog.action, `${action}%`))
    : eq(auditLog.realm, realm)
  return db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).all()
}

function actorName(db: Db, id: number | null): string | null {
  if (id === null) return null
  return db.select().from(account).where(eq(account.id, id)).get()?.name ?? null
}

function actorMnt(db: Db, id: number | null): string | null {
  if (id === null) return null
  return db.select().from(account).where(eq(account.id, id)).get()?.activeMnt ?? null
}

function parseDetail(detail: string | null): unknown {
  if (!detail) return null
  try {
    return JSON.parse(detail)
  } catch {
    return detail
  }
}
