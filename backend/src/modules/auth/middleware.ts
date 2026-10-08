/**
 * Authentication guards (M4/T4.7).
 *
 * `principal` is resolved from the realm session and attached to the request;
 * `requireSession` and `requireAdmin` are pre-handlers for protected routes.
 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import type { Realm } from '@epass42/shared'
import { getAccount, isAdmin, type AccountRow } from './authorization'
import type { SessionStore, SessionRecord } from './session'

/** The authenticated (possibly anonymous) caller of a realm request. */
export interface Principal {
  realm: Realm
  account: AccountRow
  isAdmin: boolean
  session: SessionRecord
}

/** Dependencies for resolving a principal. */
export interface AuthContext {
  db: Db
  config: AppConfig
  sessions: SessionStore
}

/** Resolves the request principal from its realm session, or null. */
export function resolvePrincipal(
  context: AuthContext,
  request: FastifyRequest,
  realm: Realm,
): Principal | null {
  const token = context.sessions.tokenFrom(request, realm)
  const record = context.sessions.get(realm, token)
  if (!record || record.accountId === null) return null
  const account = getAccount(context.db, record.accountId)
  if (!account) return null
  return {
    realm,
    account,
    isAdmin: isAdmin(context.db, context.config, realm, account),
    session: record,
  }
}

/** True when the realm's role is enabled in this deployment. */
export function realmEnabled(config: AppConfig, realm: Realm): boolean {
  return (config.roles as readonly string[]).includes(realm)
}

/** pre-handler: reject when no session principal is present (401). */
export function requireSession(context: AuthContext, fixedRealm?: Realm): preHandlerHookHandler {
  return async (request, reply) => {
    const realm = fixedRealm ?? (request.params as { realm: Realm }).realm
    const principal = resolvePrincipal(context, request, realm)
    if (!principal) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    request.principal = principal
  }
}

/** pre-handler: reject when the principal is not an administrator (403). */
export function requireAdmin(context: AuthContext, fixedRealm?: Realm): preHandlerHookHandler {
  return async (request, reply) => {
    const realm = fixedRealm ?? (request.params as { realm: Realm }).realm
    const principal = resolvePrincipal(context, request, realm)
    if (!principal) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    if (!principal.isAdmin) {
      await reply.code(403).send({ error: 'forbidden' })
      return
    }
    request.principal = principal
  }
}

/** Verifies the CSRF header against the session token (T4.9). */
export function csrfValid(request: FastifyRequest, realm: Realm, context: AuthContext): boolean {
  const header = request.headers['x-csrf-token']
  if (typeof header !== 'string') return false
  const token = context.sessions.tokenFrom(request, realm)
  const record = context.sessions.get(realm, token)
  return record !== null && record.data.csrf !== '' && record.data.csrf === header
}

/** Only relative, single-slash redirect targets are accepted (open-redirect guard). */
export function sanitizeRedirect(target: unknown): string | undefined {
  if (typeof target !== 'string') return undefined
  if (!target.startsWith('/') || target.startsWith('//')) return undefined
  if (target.includes('\\') || target.includes('\n') || target.includes('\r')) return undefined
  return target
}
