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
import { eq } from 'drizzle-orm'
import { writeAudit } from '../../audit/audit'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { asConfig } from '../../db/schema'
import {
  canReview,
  dscScope,
  recordAsAdmin,
  removeAsAdmin,
  type DscScope,
} from '../auth/authorization'
import { requireAdmin, resolvePrincipal, type AuthContext } from '../auth/middleware'
import type { SessionStore } from '../auth/session'
import type { Mailer } from '../../mail/mailer'
import { DscService, type SignRequestRow } from './service'
import type { IssuingDefaults } from './build'

/** Dependencies for the DSC routes. */
export interface DscRouteDeps {
  config: AppConfig
  db: Db
  sessions: SessionStore
  service: DscService
  mailer?: Mailer
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

      // Email notification with a two-step (non-consuming) landing link.
      if (updated.email && deps.mailer) {
        const confirmToken = service.createRevealToken(updated.id, 'confirm', 7 * 86_400)
        service.createMailToken(updated.id, 'approved', 7 * 86_400)
        const link = `${deps.config.publicUrl.replace(/\/$/, '')}/dsc/reveal/${confirmToken}`
        await deps.mailer
          .send({
            to: updated.email,
            subject: 'pkd42: your signing request was approved',
            text:
              `Your signing request was approved.\n\n` +
              `Open this link to view the details before claiming (claiming is one-time):\n${link}\n`,
          })
          .catch(() => undefined)
        writeAudit(db, {
          actorAccountId: principal.account.id,
          realm: 'dsc',
          action: 'dsc.request.email',
          targetType: 'sign_request',
          targetId: row.id,
          ip: request.ip,
        })
      }
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

  /* ---------------------------------------------------------------- *
   * Delivery (M8)
   * ---------------------------------------------------------------- */

  server.get(
    '/dsc/requests/:reference/preview',
    {
      schema: { params: referenceParams },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const preview = service.preview(request.params.reference)
      if (!preview) return reply.code(404).send({ error: 'request_not_found' })
      return reply.send(preview)
    },
  )

  server.post(
    '/dsc/requests/:reference/reveal',
    {
      schema: { params: referenceParams },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      const result = service.revealByReference(
        request.params.reference,
        principal?.account.id ?? null,
      )
      writeAudit(db, {
        actorAccountId: principal?.account.id ?? null,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: result.row.id,
        ip: request.ip,
        detail: { channel: 'applicant' },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
    },
  )

  // Two-step email landing: view metadata without consuming.
  server.post(
    '/dsc/reveal/:token',
    { schema: { params: z.object({ token: z.string().min(8).max(128) }) } },
    async (request, reply) => {
      const row = service.resolveRevealToken(request.params.token)
      reply.header('cache-control', 'no-store')
      return reply.send(service.metadata(row))
    },
  )

  server.post(
    '/dsc/requests/:id/regenerate',
    {
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        body: z.object({}).default({}),
      },
      preHandler: requireAdmin(deps as AuthContext, 'dsc'),
    },
    async (request, reply) => {
      const row = service.getById(request.params.id)
      if (!row) return reply.code(404).send({ error: 'request_not_found' })
      if (row.status !== 'approved') return reply.code(409).send({ error: 'request_not_approved' })
      const updated = await service.regenerate(row, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.regenerate',
        targetType: 'sign_request',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.send({ id: updated.id, ...service.metadata(updated) })
    },
  )

  server.get(
    '/dsc/admin/requests',
    { preHandler: requireAdmin(deps as AuthContext, 'dsc') },
    async () => {
      const items = service.adminQueue().map((row) => service.metadata(row))
      return { items }
    },
  )

  server.post(
    '/dsc/admin/requests/:id/reveal',
    {
      schema: { params: z.object({ id: z.coerce.number().int().positive() }) },
      preHandler: requireAdmin(deps as AuthContext, 'dsc'),
    },
    async (request, reply) => {
      const result = service.revealById(request.params.id, request.principal!.account.id)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: 'dsc',
        action: 'dsc.request.reveal',
        targetType: 'sign_request',
        targetId: result.row.id,
        ip: request.ip,
        detail: { channel: 'reviewer' },
      })
      reply.header('cache-control', 'no-store')
      return reply.type('text/plain').send(result.perso)
    },
  )

  server.get(
    '/dsc/settings/delivery-mode',
    { preHandler: requireAdmin(deps as AuthContext, 'dsc') },
    async () => ({ deliveryMode: service.getDeliveryMode() }),
  )

  server.put(
    '/dsc/settings/delivery-mode',
    {
      schema: { body: z.object({ deliveryMode: z.enum(['applicant', 'reviewer']) }) },
      preHandler: requireAdmin(deps as AuthContext, 'dsc'),
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

  server.get(
    '/dsc/settings/issuing-profile',
    { preHandler: requireAdmin(deps as AuthContext, 'dsc') },
    async () => service.issuingDefaults(),
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
          endorsements: z.string().max(70).optional(),
        }),
      },
      preHandler: requireAdmin(deps as AuthContext, 'dsc'),
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
    const row = db.select().from(asConfig).where(eq(asConfig.asn, principal.account.asn)).get()
    return {
      asn: principal.account.asn,
      activeMnt: principal.account.activeMnt,
      useNiaDsc: row ? row.useNiaDsc : true,
    }
  })

  server.put(
    '/dsc/settings/as',
    { schema: { body: z.object({ useNiaDsc: z.boolean() }) } },
    async (request, reply) => {
      const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
      if (!principal) return reply.code(401).send({ error: 'unauthorized' })
      if (principal.account.asn === null) return reply.code(400).send({ error: 'no_asn' })
      const asn = principal.account.asn
      db.insert(asConfig)
        .values({
          asn,
          useNiaDsc: request.body.useNiaDsc,
          updatedBy: principal.account.id,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: asConfig.asn,
          set: {
            useNiaDsc: request.body.useNiaDsc,
            updatedBy: principal.account.id,
            updatedAt: new Date().toISOString(),
          },
        })
        .run()
      if (request.body.useNiaDsc && principal.account.activeMnt) {
        recordAsAdmin(db, principal.account.activeMnt, asn)
      } else if (principal.account.activeMnt) {
        removeAsAdmin(db, principal.account.activeMnt)
      }
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: 'dsc',
        action: 'dsc.settings.as',
        ip: request.ip,
        detail: { asn, useNiaDsc: request.body.useNiaDsc },
      })
      return { asn, useNiaDsc: request.body.useNiaDsc }
    },
  )
}

export type { SignRequestRow }
