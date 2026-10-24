/**
 * Generic certificate-application workflow (P2).
 *
 * The CSCA (DSC/LDS2), CVCA (DV) and DV (terminal) realms all expose the same
 * five routes: submit, list, view, approve and reject.  They share the owner /
 * administrator rules, the "already reviewed" guard, audit logging and response
 * codes.  This helper owns that skeleton; each realm supplies its table access,
 * body schema and issuance callback.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z, type ZodTypeAny } from 'zod'

import type { Realm } from '@epass42/shared'

import { writeAudit } from '../audit/audit'
import {
  requireAdmin,
  requireSession,
  type AuthContext,
  type Principal,
} from '../modules/auth/middleware'

/** An audit action, fixed or derived from the body/row. */
type AuditAction<T> = string | ((value: T) => string)

/** The list query shared by every application endpoint. */
export interface ApplicationQuery {
  status?: string
  limit: number
  offset: number
}

/** The hooks a realm provides to the shared application routes. */
export interface ApplicationWorkflow<TRow extends { id: number; status: string }, TBody, TApprove> {
  basePath: string
  realm: Realm
  targetType: string
  bodySchema: ZodTypeAny
  /** Accepts `{}`, `null` or no body when approval takes no parameters. */
  approveBodySchema: ZodTypeAny
  actions: {
    submit: AuditAction<TBody>
    view: AuditAction<TRow>
    approve: AuditAction<TRow>
    reject: AuditAction<TRow>
  }
  /** Inserts the application and returns its id (may throw AppError). */
  submit(principal: Principal, body: TBody, ip: string | undefined): number
  find(id: number): TRow | undefined
  list(
    principal: Principal,
    query: ApplicationQuery,
  ): { total: number; items: unknown[]; scope?: string }
  approve(row: TRow, principal: Principal, body: TApprove | null | undefined): Promise<unknown>
  reject(row: TRow, principal: Principal, reason: string): void
  /** Extra fields for the detail response (e.g. hasPrivateKey, signingDv). */
  detail?(row: TRow): Promise<Record<string, unknown>> | Record<string, unknown>
  submitDetail?(body: TBody): Record<string, unknown> | undefined
  approveDetail?(body: TApprove | null | undefined): Record<string, unknown> | undefined
}

const paramsSchema = z.object({ id: z.coerce.number().int().positive() })
const listQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
const rejectBodySchema = z.object({ reason: z.string().min(1).max(2000) })

/** Resolves an audit action against the value it describes. */
function actionOf<T>(action: AuditAction<T>, value: T): string {
  return typeof action === 'function' ? action(value) : action
}

/** Registers the shared submit/list/detail/approve/reject routes. */
export function registerApplicationWorkflow<
  TRow extends { id: number; status: string },
  TBody,
  TApprove,
>(
  app: FastifyInstance,
  deps: AuthContext,
  workflow: ApplicationWorkflow<TRow, TBody, TApprove>,
): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { db } = deps

  server.post(
    workflow.basePath,
    {
      schema: { body: workflow.bodySchema },
      preHandler: requireSession(deps, workflow.realm),
    },
    async (request, reply) => {
      const principal = request.principal!
      const body = request.body as TBody
      const id = workflow.submit(principal, body, request.ip)
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: workflow.realm,
        action: actionOf(workflow.actions.submit, body),
        targetType: workflow.targetType,
        targetId: id,
        ip: request.ip,
        detail: workflow.submitDetail?.(body),
      })
      return reply.code(201).send({ id, status: 'submitted' })
    },
  )

  server.get(
    workflow.basePath,
    {
      schema: { querystring: listQuerySchema },
      preHandler: requireSession(deps, workflow.realm),
    },
    async (request) => {
      const principal = request.principal!
      return workflow.list(principal, request.query as ApplicationQuery)
    },
  )

  server.get(
    `${workflow.basePath}/:id`,
    {
      schema: { params: paramsSchema },
      preHandler: requireSession(deps, workflow.realm),
    },
    async (request, reply) => {
      const principal = request.principal!
      const row = workflow.find(request.params.id)
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (!canManage(principal, row)) return reply.code(403).send({ error: 'forbidden' })
      writeAudit(db, {
        actorAccountId: principal.account.id,
        realm: workflow.realm,
        action: actionOf(workflow.actions.view, row),
        targetType: workflow.targetType,
        targetId: row.id,
        ip: request.ip,
      })
      const extra = workflow.detail ? await workflow.detail(row) : {}
      return { ...row, ...extra }
    },
  )

  server.post(
    `${workflow.basePath}/:id/approve`,
    {
      schema: { params: paramsSchema, body: workflow.approveBodySchema },
      preHandler: requireAdmin(deps, workflow.realm),
    },
    async (request, reply) => {
      const row = workflow.find(request.params.id)
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      const body = request.body as TApprove | null | undefined
      const result = await workflow.approve(row, request.principal!, body)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: workflow.realm,
        action: actionOf(workflow.actions.approve, row),
        targetType: workflow.targetType,
        targetId: row.id,
        ip: request.ip,
        detail: workflow.approveDetail?.(body),
      })
      return reply.code(201).send(result)
    },
  )

  server.post(
    `${workflow.basePath}/:id/reject`,
    {
      schema: { params: paramsSchema, body: rejectBodySchema },
      preHandler: requireAdmin(deps, workflow.realm),
    },
    async (request, reply) => {
      const row = workflow.find(request.params.id)
      if (!row) return reply.code(404).send({ error: 'application_not_found' })
      if (row.status !== 'submitted')
        return reply.code(409).send({ error: 'application_already_reviewed' })
      workflow.reject(row, request.principal!, request.body.reason)
      writeAudit(db, {
        actorAccountId: request.principal!.account.id,
        realm: workflow.realm,
        action: actionOf(workflow.actions.reject, row),
        targetType: workflow.targetType,
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(200).send({ id: row.id, status: 'rejected' })
    },
  )
}

/** Owner or realm administrator. */
export function canManage(principal: Principal, row: unknown): boolean {
  const owner = (row as { applicantAccountId?: number | null }).applicantAccountId ?? null
  return principal.isAdmin || owner === principal.account.id
}
