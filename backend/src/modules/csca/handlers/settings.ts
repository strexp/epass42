/**
 * CSCA AS delegation settings (M4/T4.11): the AS administrator chooses between
 * the NIA DSC and the AS's own certificate.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { readAsDelegation, setAsDelegation } from '../../as/delegation'
import { resolvePrincipal } from '../../auth/middleware'
import type { CscaRouteDeps } from '../routeContext'

/** Registers the AS delegation settings routes. */
export function registerSettingsRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.get('/csca/settings/as', async (request, reply) => {
    const principal = resolvePrincipal(deps, request, 'csca')
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (principal.account.asn === null) return reply.code(400).send({ error: 'no_asn' })
    return readAsDelegation(db, principal.account)
  })

  server.put(
    '/csca/settings/as',
    { schema: { body: z.object({ useNiaDsc: z.boolean() }) } },
    async (request, reply) => {
      const principal = resolvePrincipal(deps, request, 'csca')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      if (principal.account.asn === null) return reply.code(400).send({ error: 'no_asn' })
      // Switching to the AS's own DSC requires an approved, active DSC.
      if (!request.body.useNiaDsc) {
        const current = readAsDelegation(db, principal.account)
        if (!current.hasActiveDsc) return reply.code(409).send({ error: 'no_active_dsc' })
      }
      const updated = setAsDelegation(db, principal.account, request.body.useNiaDsc)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: 'csca.settings.as',
        ip: request.ip,
        detail: { asn: updated.asn, useNiaDsc: request.body.useNiaDsc },
      })
      return updated
    },
  )
}
