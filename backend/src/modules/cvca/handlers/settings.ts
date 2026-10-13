/**
 * CVCA maintainer DV delegation settings (M18): the maintainer chooses between
 * the CVCA default (system) DV and one of its own DV certificates.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { readDvDelegation, setDvDelegation } from '../../mnt/dvDelegation'
import { resolvePrincipal } from '../../auth/middleware'
import type { CvcaRouteDeps } from '../routeContext'

/** Registers the CVCA maintainer delegation settings routes. */
export function registerSettingsRoutes(app: FastifyInstance, deps: CvcaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.get('/cvca/settings/mnt', async (request, reply) => {
    const principal = resolvePrincipal(deps, request, 'cvca')
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (principal.account.activeMnt === null) return reply.code(400).send({ error: 'no_mnt' })
    return readDvDelegation(db, principal.account)
  })

  server.put(
    '/cvca/settings/mnt',
    { schema: { body: z.object({ useNiaDv: z.boolean() }) } },
    async (request, reply) => {
      const principal = resolvePrincipal(deps, request, 'cvca')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      if (principal.account.activeMnt === null) return reply.code(400).send({ error: 'no_mnt' })
      // Switching to the maintainer's own DV requires an approved, active DV.
      if (!request.body.useNiaDv) {
        const current = readDvDelegation(db, principal.account)
        if (!current.hasActiveDv) return reply.code(409).send({ error: 'no_active_dv' })
      }
      const updated = setDvDelegation(db, principal.account, request.body.useNiaDv)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'cvca',
        action: 'cvca.settings.mnt',
        ip: request.ip,
        detail: { mnt: updated.mnt, useNiaDv: request.body.useNiaDv },
      })
      return updated
    },
  )
}
