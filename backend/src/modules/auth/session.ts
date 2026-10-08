/**
 * Session storage and cookies (M4/T4.3, T4.4).
 *
 * Each realm has an independent session table namespace (the `realm` column)
 * and an independent cookie name, so a CSCA session can never authenticate a
 * DSC request.  Only the SHA-256 hash of the token is stored.
 */
import type { FastifyReply, FastifyRequest } from 'fastify'
import { and, eq, lt } from 'drizzle-orm'

import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { session } from '../../db/schema'
import { hashToken, randomToken } from '../../crypto/secret'
import { isExpired, isoInSeconds, nowIso } from '../../util/time'
import type { Realm } from '@epass42/shared'

/** Data carried inside a session. */
export interface SessionData {
  /** CSRF token for state-changing requests. */
  csrf: string
  [key: string]: unknown
}

/** A resolved session. */
export interface SessionRecord {
  realm: Realm
  accountId: number | null
  data: SessionData
}

/** Session store backed by SQLite. */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  /** The per-realm cookie name. */
  cookieName(realm: Realm): string {
    return `epass42_${realm}_sid`
  }

  /** Cookie options for `Set-Cookie`. */
  cookieOptions(): {
    httpOnly: boolean
    secure: boolean
    sameSite: 'lax'
    path: string
    maxAge: number
    domain?: string
  } {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.sessionTtlSeconds,
      domain: this.config.cookieDomain,
    }
  }

  /** Creates a session and returns the raw token (store only its hash). */
  create(realm: Realm, accountId: number | null, data: SessionData): string {
    const token = randomToken(32)
    this.db
      .insert(session)
      .values({
        id: hashToken(token),
        realm,
        accountId,
        data: JSON.stringify(data),
        createdAt: nowIso(),
        expiresAt: isoInSeconds(this.config.sessionTtlSeconds),
      })
      .run()
    return token
  }

  /** Resolves a token, refreshes the sliding expiry and returns the session. */
  get(realm: Realm, token: string | undefined): SessionRecord | null {
    if (!token) return null
    const id = hashToken(token)
    const row = this.db
      .select()
      .from(session)
      .where(and(eq(session.id, id), eq(session.realm, realm)))
      .get()
    if (!row) return null
    if (isExpired(row.expiresAt)) {
      this.db.delete(session).where(eq(session.id, id)).run()
      return null
    }
    const expiresAt = isoInSeconds(this.config.sessionTtlSeconds)
    this.db.update(session).set({ expiresAt }).where(eq(session.id, id)).run()
    return {
      realm: row.realm as Realm,
      accountId: row.accountId,
      data: parseData(row.data),
    }
  }

  /** Destroys a session. */
  destroy(realm: Realm, token: string | undefined): void {
    if (!token) return
    this.db
      .delete(session)
      .where(and(eq(session.id, hashToken(token)), eq(session.realm, realm)))
      .run()
  }

  /** Removes expired sessions (called opportunistically). */
  pruneExpired(): void {
    this.db.delete(session).where(lt(session.expiresAt, nowIso())).run()
  }

  /** Reads the session token from the realm cookie. */
  tokenFrom(request: FastifyRequest, realm: Realm): string | undefined {
    return request.cookies[this.cookieName(realm)]
  }

  /** Writes the session cookie. */
  setCookie(reply: FastifyReply, realm: Realm, token: string): void {
    reply.setCookie(this.cookieName(realm), token, this.cookieOptions())
  }

  /** Clears the session cookie. */
  clearCookie(reply: FastifyReply, realm: Realm): void {
    reply.clearCookie(this.cookieName(realm), { path: '/' })
  }
}

function parseData(raw: string | null): SessionData {
  if (!raw) return { csrf: '' }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionData>
    return { ...parsed, csrf: typeof parsed.csrf === 'string' ? parsed.csrf : '' }
  } catch {
    return { csrf: '' }
  }
}
