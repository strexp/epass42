/**
 * One-time private-key export helper (P2).
 *
 * The CSCA, CVCA and DV realms download a sealed private key once; after the
 * successful response the stored reference is cleared atomically so a second
 * caller gets 410.  This helper owns the shared response, audit and race
 * handling; each realm supplies its row, export and conditional-clear callbacks.
 */
import type { FastifyReply } from 'fastify'

import { writeAudit } from '../audit/audit'
import type { Db } from '../db/client'
import type { Principal } from '../modules/auth/middleware'

/** Inputs for {@link sendPrivateKeyOnce}. */
export interface PrivateKeyExportOptions<TRow> {
  reply: FastifyReply
  db: Db
  principal: Principal
  row: TRow
  /** The sealed key reference, or null when it was already claimed/uploaded. */
  keyRef: string | null
  /** `user_uploaded` keys were never stored, so they return 404 instead of 410. */
  keyMode: string | null
  exportKey: (row: TRow) => string
  /** Atomically clears the key; false means another request won the race. */
  consume: (row: TRow) => boolean
  targetType: string
  action: string
  targetId: number
  filename: string
  ip: string | undefined
}

/** Sends a private key once and clears the sealed reference. */
export function sendPrivateKeyOnce<TRow>(options: PrivateKeyExportOptions<TRow>): FastifyReply {
  const { reply } = options
  if (!options.keyRef) {
    const uploaded = options.keyMode === 'user_uploaded'
    return reply
      .code(uploaded ? 404 : 410)
      .send({ error: uploaded ? 'no_private_key' : 'private_key_consumed' })
  }
  const pem = options.exportKey(options.row)
  if (!options.consume(options.row)) {
    return reply.code(410).send({ error: 'private_key_consumed' })
  }
  writeAudit(options.db, {
    actorAccountId: options.principal.account.id,
    action: options.action,
    targetType: options.targetType,
    targetId: options.targetId,
    ip: options.ip,
  })
  reply.header('cache-control', 'no-store')
  reply.header('content-disposition', `attachment; filename="${options.filename}"`)
  return reply.type('application/x-pem-file').send(pem)
}
