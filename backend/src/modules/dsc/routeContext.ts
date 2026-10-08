/**
 * Shared dependency types and helpers for the DSC route handlers.
 */
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { canReview, dscScope, type DscScope } from '../auth/authorization'
import { resolvePrincipal, type AuthContext } from '../auth/middleware'
import type { SessionStore } from '../auth/session'
import type { Mailer } from '../../mail/mailer'
import type { MntResolver } from '../jurisdiction/whois'
import type { DscService, SignRequestRow } from './service'

/** Dependencies for the DSC routes. */
export interface DscRouteDeps {
  config: AppConfig
  db: Db
  sessions: SessionStore
  service: DscService
  mailer?: Mailer
  /** IP → maintainer resolver (whois in production, a fake in tests). */
  resolver: MntResolver
}

export const referenceParams = z.object({ reference: z.string().min(8).max(128) })
export const idParams = z.object({ id: z.coerce.number().int().positive() })

/** Returns the caller's DSC review scope, or null when unauthenticated. */
export function scopeOf(deps: DscRouteDeps, request: FastifyRequest): DscScope | null {
  const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
  if (!principal) return null
  request.principal = principal
  return dscScope(deps.db, deps.config, principal.account)
}

/** Authorizes access to a request by its owner, reviewer scope or NIA admin. */
export function accessRow(
  deps: DscRouteDeps,
  request: FastifyRequest,
  row: SignRequestRow,
): { ok: boolean; status?: number } {
  const principal = resolvePrincipal(deps as AuthContext, request, 'dsc')
  if (!principal) return { ok: false, status: 401 }
  request.principal = principal
  if (row.requesterAccountId === principal.account.id) return { ok: true }
  const scope = dscScope(deps.db, deps.config, principal.account)
  if (scope.kind === 'nia' || canReview(scope, row)) return { ok: true }
  return { ok: false, status: 403 }
}
