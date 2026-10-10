/**
 * DSC request intake, status, listing and jurisdiction routes (M7).
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { buildMrzLines, validateMrzLines } from '@epass42/pki'
import { signRequestSchema, type SignRequest, LIMITS } from '@epass42/shared'

import { writeAudit } from '../../../audit/audit'
import { adminMnts, mntDelegatesToNia } from '../../auth/authorization'
import { activeOwnDsc } from '../../mnt/delegation'
import { canonicalMnts } from '../../jurisdiction/whois'
import { resolvePrincipal, type AuthContext } from '../../auth/middleware'
import { scopeOf, accessRow, referenceParams, type DscRouteDeps } from '../routeContext'

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
      // Submitting a signing request requires an authenticated applicant.
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      request.principal = principal
      const mnt = principal.account.activeMnt ?? (await resolveIpMnt(deps, request.ip))
      const requester = {
        accountId: principal.account.id,
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
      // Reference lookup is restricted to the owner, NIA administrators and
      // delegated reviewers acting within their own jurisdiction.
      const access = accessRow(deps, request, row)
      if (!access.ok) {
        return reply
          .code(access.status ?? 403)
          .send({ error: access.status === 401 ? 'unauthorized' : 'forbidden' })
      }
      return reply.send(service.metadata(row))
    },
  )

  server.get(
    '/dsc/requests',
    {
      schema: {
        querystring: z.object({
          status: z.string().optional(),
          /** Force the caller's own requests, ignoring any review scope. */
          mine: z
            .string()
            .optional()
            .transform((value) => value === '1' || value === 'true'),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      const scope = scopeOf(deps, request)
      const principal = request.principal
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      // "My requests" is keyed by the internal account id, so it works for any
      // login method — including identities without a dn42 claim.  Without
      // `mine`, reviewers additionally see the requests in their review scope.
      const ownOnly = request.query.mine || !scope || scope.kind === 'none'
      const items = ownOnly
        ? service.list({
            accountId: principal.account.id,
            status: request.query.status,
            limit: request.query.limit,
            offset: request.query.offset,
          })
        : service.list({
            scope: scope!,
            status: request.query.status,
            limit: request.query.limit,
            offset: request.query.offset,
          })
      return { items: items.map((row) => service.metadata(row)) }
    },
  )

  // IP / session based maintainer jurisdiction: tells the applicant whether its
  // maintainer uses its own DSC (so it can be redirected away from NIA), and
  // who reviews an NIA-signed request (its own maintainer + the DSC admins).
  server.get('/dsc/jurisdiction', async (request) => {
    const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
    const ownMnt = principal?.account.activeMnt ?? null
    const mnts = ownMnt ? [ownMnt] : await resolveIpMnts(deps, request.ip)
    const reviewers = [
      ...new Set([...(ownMnt ? [ownMnt] : []), ...adminMnts(db, deps.config, 'dsc')]),
    ]
    if (mnts.length === 0) {
      return { mnts: [], useNiaDsc: null, notice: false, ownDscUrl: null, reviewers }
    }
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
    return { mnts, useNiaDsc: !notice, notice, ownDscUrl, reviewers }
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
