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
import { scopeOf, referenceParams, type DscRouteDeps } from '../routeContext'

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
        targetId: result.reference,
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
      return { items: items.map((row) => service.metadata(row)) }
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
