/**
 * DSC passport routes: the applicant's currently active passport and its
 * self-service revocation.  Approving a new request supersedes the previous
 * active passport, so an applicant has at most one active passport at a time.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { resolvePrincipal, type AuthContext } from '../../auth/middleware'
import { referenceParams, type DscRouteDeps } from '../routeContext'

/** Registers the active-passport lookup and revocation routes. */
export function registerPassportRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  // The applicant's current active passport (or `null` when none is active).
  server.get('/dsc/passports/active', async (request, reply) => {
    const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    const row = service.activePassport(principal.account.id)
    if (!row) return reply.send({ passport: null })
    // The caller owns the passport, so the document number may be shown.
    const payload = service.full(row)
    return reply.send({
      passport: { ...service.metadata(row), documentNumber: payload.mrz.documentNumber },
    })
  })

  // Applicant self-service revocation of the current active passport.
  server.post(
    '/dsc/passports/:reference/revoke',
    {
      schema: {
        params: referenceParams,
        body: z.object({ reason: z.string().max(2000).optional() }).default({}),
      },
    },
    async (request, reply) => {
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const owned = row.requesterAccountId === principal.account.id
      if (!owned && !principal.isAdmin) return reply.code(403).send({ error: 'forbidden' })
      if (row.status !== 'approved') return reply.code(409).send({ error: 'passport_not_active' })
      const updated = service.revokePassport(row, request.body.reason ?? null)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.passport.revoke',
        targetType: 'sign_request',
        targetId: row.reference,
        ip: request.ip,
        detail: { reason: request.body.reason ?? null },
      })
      return reply.send(service.metadata(updated))
    },
  )
}
