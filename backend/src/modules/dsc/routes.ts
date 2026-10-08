/**
 * DSC signing routes (M7, Appendix D):
 *
 *   POST /dsc/requests               (optional session)  submit a signing request
 *   GET  /dsc/requests/:reference    (public)             metadata only
 *   GET  /dsc/requests               (session)            own history / scoped review
 *   POST /dsc/requests/:id/approve   (NIA admin or delegated AS reviewer)
 *   POST /dsc/requests/:id/reject    (NIA admin or delegated AS reviewer)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { buildMrzLines, validateMrzLines } from '@pkd42/pki'
import { signRequestSchema, type SignRequest, LIMITS } from '@pkd42/shared'
import { writeAudit } from '../../audit/audit'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { canReview, dscScope, type DscScope } from '../auth/authorization'
import { resolvePrincipal, type AuthContext } from '../auth/middleware'
import type { SessionStore } from '../auth/session'
import { DscService, type SignRequestRow } from './service'
import type { IssuingDefaults } from './build'

/** Dependencies for the DSC routes. */
export interface DscRouteDeps {
  config: AppConfig
  db: Db
  sessions: SessionStore
  service: DscService
}

const referenceParams = z.object({ reference: z.string().min(8).max(128) })

/** Returns the caller's DSC review scope, or null when unauthenticated. */
function scopeOf(deps: DscRouteDeps, request: FastifyRequest): DscScope | null {
  const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
  if (!principal) return null
  request.principal = principal
  return dscScope(deps.db, deps.config, principal.account)
}

/** Registers the DSC signing routes. */
export function registerDscRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/dsc/requests',
    { schema: { body: signRequestSchema }, bodyLimit: LIMITS.requestPayload },
    async (request, reply) => {
      const payload = request.body as SignRequest
      const mrzValidation = validateMrzLines(buildMrzLines(payload.mrz))
      if (!mrzValidation.valid) {
        return reply.code(400).send({ error: 'mrz_invalid', details: mrzValidation.errors })
      }
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      const requester = {
        accountId: principal?.account.id ?? null,
        asn: principal?.account.asn ?? null,
        ip: request.ip,
      }
      const result = service.submit(payload, requester)
      writeAudit(db, {
        actorAccountId: requester.accountId,
        realm: 'dsc',
        action: 'dsc.request.submit',
        targetType: 'sign_request',
        targetId: result.id,
        ip: request.ip,
      })
      return reply.code(201).send({ reference: result.reference, status: result.status })
    },
  )

  server.get(
    '/dsc/requests/:reference',
    {
      schema: { params: referenceParams },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const row = service.getByReference(request.params.reference)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      return reply.send(service.metadata(row))
    },
  )

  server.get(
    '/dsc/requests',
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      const items =
        scope && scope.kind !== 'none'
          ? service.list({
              scope,
              status: request.query.status,
              limit: request.query.limit,
              offset: request.query.offset,
            })
          : service.list({
              accountId: principal.account.id,
              status: request.query.status,
              limit: request.query.limit,
              offset: request.query.offset,
            })
      return { items: items.map((row) => ({ id: row.id, ...service.metadata(row) })) }
    },
  )

  server.post(
    '/dsc/requests/:id/approve',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z
          .object({
            deliveryMode: z.enum(['applicant', 'reviewer']).optional(),
            profileOverrides: z.record(z.string(), z.string()).optional(),
          })
          .default({}),
      },
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!scope || !principal) return reply.code(401).send({ error: 'unauthorized' })
      if (!canReview(scope, { asn: row.asn, dscSelection: row.dscSelection })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      if (scope.kind !== 'nia' && (request.body.deliveryMode || request.body.profileOverrides)) {
        return reply.code(403).send({ error: 'forbidden_settings' })
      }
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'request_not_reviewable' })
      const updated = await service.approve(row, principal.account.id, {
        deliveryMode: request.body.deliveryMode,
        profileOverrides: request.body.profileOverrides as Partial<IssuingDefaults> | undefined,
      })
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.request.approve',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.send({ id: updated.id, ...service.metadata(updated) })
    },
  )

  server.post(
    '/dsc/requests/:id/reject',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({ reason: z.string().min(1).max(2000) }),
      },
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!scope || !principal) return reply.code(401).send({ error: 'unauthorized' })
      if (!canReview(scope, { asn: row.asn, dscSelection: row.dscSelection })) {
        return reply.code(403).send({ error: 'forbidden' })
      }
      service.reject(row, principal.account.id, request.body.reason)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.request.reject',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.send({ id: row.id, status: 'rejected' })
    },
  )
}

export type { SignRequestRow }
