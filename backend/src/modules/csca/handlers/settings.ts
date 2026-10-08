/**
 * CSCA maintainer delegation settings (M4/T4.11): the maintainer chooses between
 * the NIA DSC and its own certificate.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { readMntDelegation, setMntDelegation } from '../../mnt/delegation'
import { resolvePrincipal } from '../../auth/middleware'
import type { CscaRouteDeps } from '../routeContext'

/** Registers the maintainer delegation settings routes. */
export function registerSettingsRoutes(app: FastifyInstance, deps: CscaRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.get('/csca/settings/mnt', async (request, reply) => {
    const principal = resolvePrincipal(deps, request, 'csca')
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (principal.account.activeMnt === null) return reply.code(400).send({ error: 'no_mnt' })
    return readMntDelegation(db, principal.account)
  })

  server.put(
    '/csca/settings/mnt',
    { schema: { body: z.object({ useNiaDsc: z.boolean() }) } },
    async (request, reply) => {
      const principal = resolvePrincipal(deps, request, 'csca')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      if (principal.account.activeMnt === null) return reply.code(400).send({ error: 'no_mnt' })
      // Switching to the maintainer's own DSC requires an approved, active DSC.
      if (!request.body.useNiaDsc) {
        const current = readMntDelegation(db, principal.account)
        if (!current.hasActiveDsc) return reply.code(409).send({ error: 'no_active_dsc' })
      }
      const updated = setMntDelegation(db, principal.account, request.body.useNiaDsc)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'csca',
        action: 'csca.settings.mnt',
        ip: request.ip,
        detail: { mnt: updated.mnt, useNiaDsc: request.body.useNiaDsc },
      })
      return updated
    },
  )
}
