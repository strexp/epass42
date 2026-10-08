/**
 * DSC request intake, status, listing and jurisdiction routes (M7).
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'

import { buildMrzLines, validateMrzLines } from '@pkd42/pki'
import { signRequestSchema, type SignRequest, LIMITS } from '@pkd42/shared'

import { writeAudit } from '../../../audit/audit'
import { asConfig, dscCert } from '../../../db/schema'
import { findAsn } from '../../../util/ip'
import { resolvePrincipal, type AuthContext } from '../../auth/middleware'
import { buildPreview } from '../preview'
import { scopeOf, accessRow, idParams, referenceParams, type DscRouteDeps } from '../routeContext'

/** Registers the request submission and status routes. */
export function registerRequestRoutes(app: FastifyInstance, deps: DscRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db, service } = deps

  server.post(
    '/dsc/requests',
    { schema: { body: signRequestSchema }, bodyLimit: LIMITS.requestPayload },
    async (request, reply) => {
      const payload = request.body as SignRequest
      const mrzValidation = validateMrzLines(
        buildMrzLines({ ...payload.mrz, dateOfExpiry: payload.mrz.dateOfExpiry ?? '' }),
      )
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

  server.get('/dsc/requests/id/:id', { schema: { params: idParams } }, async (request, reply) => {
    const row = service.getById(request.params.id)
    if (!row) return reply.code(404).send({ error: 'request_not_found' })
    const access = accessRow(deps, request, row)
    if (!access.ok) return reply.code(access.status ?? 403).send({ error: 'forbidden' })
    return reply.send(service.metadata(row))
  })

  server.get(
    '/dsc/requests/id/:id/preview',
    { schema: { params: idParams } },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const access = accessRow(deps, request, row)
      if (!access.ok) return reply.code(access.status ?? 403).send({ error: 'forbidden' })
      const payload = JSON.parse(row.payloadJson) as SignRequest
      return reply.send(
        buildPreview(payload, undefined, payload.security ?? service.issuingDefaults().security),
      )
    },
  )

  server.post(
    '/dsc/requests/id/:id/reveal',
    { schema: { params: idParams }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      const access = accessRow(deps, request, row)
      if (!access.ok) return reply.code(access.status ?? 403).send({ error: 'forbidden' })
      const actor = request.principal!.account.id
      const scope = scopeOf(deps, request)
      const result =
        row.deliveryMode === 'applicant'
          ? service.revealOwned(row, actor)
          : scope?.kind === 'nia'
            ? service.revealById(row.id, actor)
            : null
      if (!result) return reply.code(403).send({ error: 'reveal_not_allowed' })
      writeAudit(db, {
        actorAccountId: actor,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
        detail: { channel: row.deliveryMode },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
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

  // IP / session based AS jurisdiction: tells the applicant whether their AS
  // uses its own DSC (so they can be redirected away from the NIA service).
  server.get('/dsc/jurisdiction', async (request) => {
    const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
    let asn = principal?.account.asn ?? null
    if (asn === null) asn = findAsn(deps.config.jurisdiction.routes, request.ip)
    if (asn === null) return { asn: null, useNiaDsc: null, notice: false, ownDscUrl: null }
    const row = db.select().from(asConfig).where(eq(asConfig.asn, asn)).get()
    const useNiaDsc = row ? row.useNiaDsc : true
    let ownDscUrl: string | null = null
    if (!useNiaDsc) {
      const cert = db
        .select()
        .from(dscCert)
        .where(and(eq(dscCert.asn, asn), eq(dscCert.status, 'active')))
        .get()
      ownDscUrl = cert?.applicationUrl ?? null
    }
    return { asn, useNiaDsc, notice: !useNiaDsc, ownDscUrl }
  })
}
