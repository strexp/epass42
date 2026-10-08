/**
 * DSC settings routes (M8): delivery mode, issuing profile and AS delegation.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { writeAudit } from '../../../audit/audit'
import { readAsDelegation, setAsDelegation } from '../../as/delegation'
import { requireAdmin, resolvePrincipal, type AuthContext } from '../../auth/middleware'
import type { DscRouteDeps } from '../routeContext'

/** Registers the settings routes. */
export function registerSettingsRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.get(
    '/dsc/settings/delivery-mode',
    { preHandler: requireAdmin(deps, 'dsc') },
    async () => ({ deliveryMode: service.getDeliveryMode() }),
  )

  server.put(
    '/dsc/settings/delivery-mode',
    {
      schema: { body: z.object({ deliveryMode: z.enum(['applicant', 'reviewer']) }) },
      preHandler: requireAdmin(deps, 'dsc'),
    },
    async (request) => {
      service.setDeliveryMode(request.body.deliveryMode, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.settings.delivery-mode',
        ip: request.ip,
        detail: { deliveryMode: request.body.deliveryMode },
      })
      return { deliveryMode: service.getDeliveryMode() }
    },
  )

  server.get('/dsc/settings/issuing-profile', { preHandler: requireAdmin(deps, 'dsc') }, async () =>
    service.issuingDefaults(),
  )

  server.put(
    '/dsc/settings/issuing-profile',
    {
      schema: {
        body: z.object({
          issuingState: z.string().length(3).optional(),
          issuingAuthority: z.string().max(70).optional(),
          personalizationDevice: z.string().max(70).optional(),
          dg13Policy: z.string().max(70).optional(),
          validityYears: z.number().int().min(1).max(30).optional(),
          dg2MaxBytes: z.number().int().min(1024).optional(),
          lds2: z
            .object({
              enabled: z.boolean().optional(),
              roles: z.array(z.enum(['travel', 'visa', 'biometrics'])).optional(),
              caKeyId: z.number().int().min(0).max(255).optional(),
            })
            .optional(),
          endorsements: z.string().max(70).optional(),
          security: z
            .object({
              paceEcdhGm3des: z.boolean().optional(),
              paceEcdhGmAes128: z.boolean().optional(),
              aa: z.boolean().optional(),
            })
            .optional(),
        }),
      },
      preHandler: requireAdmin(deps, 'dsc'),
    },
    async (request) => {
      const updated = service.updateIssuingProfile(request.body, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.settings.issuing-profile',
        ip: request.ip,
        detail: request.body,
      })
      return updated
    },
  )

  // Self-service AS delegation (M4/T4.11, E2): an AS administrator configures
  // whether its certificates are signed by the NIA DSC; doing so registers the
  // caller as a delegated reviewer for that AS.
  server.get('/dsc/settings/as', async (request, reply) => {
    const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    if (principal.account.asn === null) return reply.code(400).send({ error: 'no_asn' })
    return readAsDelegation(db, principal.account)
  })

  server.put(
    '/dsc/settings/as',
    { schema: { body: z.object({ useNiaDsc: z.boolean() }) } },
    async (request, reply) => {
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      if (principal.account.asn === null) return reply.code(400).send({ error: 'no_asn' })
      const updated = setAsDelegation(db, principal.account, request.body.useNiaDsc)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.settings.as',
        ip: request.ip,
        detail: { asn: updated.asn, useNiaDsc: request.body.useNiaDsc },
      })
      return updated
    },
  )
}
