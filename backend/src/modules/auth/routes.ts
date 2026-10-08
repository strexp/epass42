/**
 * Authentication routes (M4/T4.2): `/auth/{realm}/login|callback|logout|me`.
 *
 * The two realms are fully isolated: separate providers, cookies, session rows
 * and CSRF scope.  Realm routes are only registered when the role is enabled.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { randomToken } from '../../crypto/secret'
import { writeAudit } from '../../audit/audit'
import { realmSchema } from '../../config'
import { oauthFlow } from '../../db/schema'
import { isExpired, isoInSeconds, nowIso } from '../../util/time'
import type { Realm } from '@pkd42/shared'
import { mapClaims } from './claims'
import { upsertAccount } from './authorization'
import {
  csrfValid,
  realmEnabled,
  requireAdmin,
  resolvePrincipal,
  sanitizeRedirect,
  type AuthContext,
} from './middleware'
import type { AuthProviders } from './provider'

/** Dependencies for the auth routes. */
export interface AuthRouteDeps extends AuthContext {
  providers: AuthProviders
}

/** The OIDC flow state lifetime. */
const FLOW_TTL_SECONDS = 600

const realmParams = z.object({ realm: realmSchema })

/** Registers the realm authentication routes. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const { config, db, sessions, providers } = deps
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/auth/:realm/login',
    {
      schema: {
        params: realmParams,
        querystring: z.object({
          provider: z.coerce.number().int().positive().optional(),
          redirect_to: z.string().optional(),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const realm = request.params.realm as Realm
      if (!realmEnabled(config, realm)) return reply.code(404).send({ error: 'not_found' })

      const available = providers.list(realm)
      const selected = request.query.provider
        ? providers.get(realm, request.query.provider)
        : available[0]
      if (!selected) return reply.code(400).send({ error: 'no_oauth_provider' })

      const driver = providers.driver(selected)
      const flow = await driver.start()
      db.insert(oauthFlow)
        .values({
          state: flow.state,
          realm,
          providerId: selected.id,
          nonce: flow.nonce,
          codeVerifier: flow.codeVerifier,
          redirectTo: sanitizeRedirect(request.query.redirect_to) ?? null,
          createdAt: nowIso(),
          expiresAt: isoInSeconds(FLOW_TTL_SECONDS),
        })
        .run()
      return reply.redirect(flow.url)
    },
  )

  server.get(
    '/auth/:realm/callback',
    {
      schema: {
        params: realmParams,
        querystring: z.object({
          code: z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const realm = request.params.realm as Realm
      if (!realmEnabled(config, realm)) return reply.code(404).send({ error: 'not_found' })
      if (request.query.error) return reply.code(400).send({ error: 'oauth_error' })
      const { state } = request.query
      if (!state) return reply.code(400).send({ error: 'missing_state' })

      const flow = db
        .select()
        .from(oauthFlow)
        .where(and(eq(oauthFlow.state, state), eq(oauthFlow.realm, realm)))
        .get()
      if (!flow) return reply.code(400).send({ error: 'unknown_state' })
      // One-time use: consume the flow before exchanging the code.
      db.delete(oauthFlow).where(eq(oauthFlow.state, state)).run()
      if (isExpired(flow.expiresAt)) return reply.code(400).send({ error: 'expired_state' })

      const provider = providers.get(realm, flow.providerId)
      if (!provider) return reply.code(400).send({ error: 'unknown_provider' })

      const currentUrl = new URL(request.url, config.publicUrl).href
      const identity = await providers.driver(provider).complete(currentUrl, {
        url: '',
        state: flow.state,
        nonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
      })
      const mapped = mapClaims(identity.rawClaims, provider.config, provider.config.issuer)
      const account = upsertAccount(db, realm, provider.id, mapped)

      const token = sessions.create(realm, account.id, { csrf: randomToken(24) })
      sessions.setCookie(reply, realm, token)
      writeAudit(db, {
        actorAccountId: account.id,
        realm,
        action: 'auth.login',
        targetType: 'account',
        targetId: account.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      })
      return reply.redirect(sanitizeRedirect(flow.redirectTo) ?? '/')
    },
  )

  server.post(
    '/auth/:realm/logout',
    { schema: { params: realmParams } },
    async (request, reply) => {
      const realm = request.params.realm as Realm
      if (!realmEnabled(config, realm)) return reply.code(404).send({ error: 'not_found' })
      const principal = resolvePrincipal(deps, request, realm)
      if (principal && !csrfValid(request, realm, deps)) {
        return reply.code(403).send({ error: 'csrf' })
      }
      const token = sessions.tokenFrom(request, realm)
      sessions.destroy(realm, token)
      sessions.clearCookie(reply, realm)
      if (principal) {
        writeAudit(db, {
          actorAccountId: principal.account.id,
          realm,
          action: 'auth.logout',
          targetType: 'account',
          targetId: principal.account.id,
          ip: request.ip,
        })
      }
      return reply.code(204).send()
    },
  )

  server.get('/auth/:realm/me', { schema: { params: realmParams } }, async (request, reply) => {
    const realm = request.params.realm as Realm
    if (!realmEnabled(config, realm)) return reply.code(404).send({ error: 'not_found' })
    const principal = resolvePrincipal(deps, request, realm)
    if (!principal) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({
      account: {
        id: principal.account.id,
        realm,
        asn: principal.account.asn,
        activeMnt: principal.account.activeMnt,
        email: principal.account.email,
        name: principal.account.name,
      },
      isAdmin: principal.isAdmin,
      csrf: principal.session.data.csrf,
      prefill: prefillFromAccount(principal.account.rawClaims),
    })
  })

  server.get(
    '/auth/:realm/admin',
    {
      schema: { params: realmParams },
      preHandler: requireAdmin(deps),
    },
    async (request, reply) => {
      const realm = request.params.realm as Realm
      if (!realmEnabled(config, realm)) return reply.code(404).send({ error: 'not_found' })
      writeAudit(db, {
        actorAccountId: request.principal?.account.id,
        realm,
        action: 'admin.access',
        ip: request.ip,
      })
      return reply.send({ realm, isAdmin: true })
    },
  )
}

/** The claim fields the front end may prefill (T4.6). */
export function prefillFromAccount(rawClaims: string | null): Record<string, unknown> {
  if (!rawClaims) return {}
  try {
    const parsed = JSON.parse(rawClaims) as Record<string, unknown>
    const dn42 = (parsed.dn42 ?? {}) as Record<string, unknown>
    return {
      asn: dn42.asn,
      activeMnt: dn42.active_mnt,
      activeName: dn42.active_name,
      email: parsed.email,
      name: parsed.name,
      route: dn42.route,
      route6: dn42.route6,
    }
  } catch {
    return {}
  }
}
