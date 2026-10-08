/**
 * DSC request intake, status, listing and jurisdiction routes (M7).
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { buildMrzLines, validateMrzLines } from '@epass42/pki'
import { signRequestSchema, type SignRequest, LIMITS } from '@epass42/shared'

import { writeAudit } from '../../../audit/audit'
import { mntDelegatesToNia } from '../../auth/authorization'
import { activeOwnDsc } from '../../mnt/delegation'
import { canonicalMnts } from '../../jurisdiction/whois'
import { resolvePrincipal, type AuthContext } from '../../auth/middleware'
import { buildPreview } from '../preview'
import { isLds2Enabled } from '../securityOptions'
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
      const mnt = principal?.account.activeMnt ?? (await resolveIpMnt(deps, request.ip))
      const requester = {
        accountId: principal?.account.id ?? null,
        mnt,
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
      const profile = service.issuingDefaults()
      return reply.send(
        buildPreview(
          payload,
          undefined,
          payload.security ?? profile.security,
          isLds2Enabled(profile.lds2),
        ),
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

  // IP / session based maintainer jurisdiction: tells the applicant whether its
  // maintainer uses its own DSC (so it can be redirected away from NIA).
  server.get('/dsc/jurisdiction', async (request) => {
    const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
    const mnts = principal?.account.activeMnt
      ? [principal.account.activeMnt]
      : await resolveIpMnts(deps, request.ip)
    if (mnts.length === 0) return { mnts: [], useNiaDsc: null, notice: false, ownDscUrl: null }
    // The notice applies when any of the IP's maintainers uses its own DSC.
    const notice = mnts.some((mnt) => !mntDelegatesToNia(db, mnt))
    let ownDscUrl: string | null = null
    for (const mnt of mnts) {
      const cert = activeOwnDsc(db, mnt)
      if (cert?.applicationUrl) {
        ownDscUrl = cert.applicationUrl
        break
      }
    }
    return { mnts, useNiaDsc: !notice, notice, ownDscUrl }
  })
}

/** Resolves the IP's maintainers, tolerating whois failures. */
async function resolveIpMnts(deps: DscRouteDeps, ip: string): Promise<string[]> {
  try {
    return await deps.resolver.resolve(ip)
  } catch {
    return []
  }
}

/** Resolves the IP's canonical maintainer set for storage. */
async function resolveIpMnt(deps: DscRouteDeps, ip: string): Promise<string | null> {
  return canonicalMnts(await resolveIpMnts(deps, ip))
}
