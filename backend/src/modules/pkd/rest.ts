/**
 * PKD REST surface (M9/T9.2, Appendix D):
 * `GET /pkd/{certificates,crls,masterlists,dscs,revoked,revoked/:hash,ldif}`,
 * `POST /pkd/revoked/check`, `GET /pkd/objects/:id.:format`.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc } from 'drizzle-orm'
import { z } from 'zod'

import { derToPem } from '@epass42/pki'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { dscCert, dvCert } from '../../db/schema'
import { writeAudit } from '../../audit/audit'
import { requireAdmin, type AuthContext } from '../auth/middleware'
import type { SessionStore } from '../auth/session'
import { certMetadata } from '../csca/routeContext'
import type { CscaService } from '../csca/service'
import { parsePermissions } from '../cvca/service'
import { listObjects } from './directory'
import { buildLdif } from './ldif'
import {
  REVOKE_HASH_ALGORITHM,
  REVOKE_HASH_CANONICAL,
  REVOKE_HASH_FIELDS,
  isRevokedHash,
  listRevokedDocuments,
  revokedDocumentHash,
  type DocumentLookup,
} from './revoked'

/** Dependencies for the PKD routes. */
export interface PkdRouteDeps {
  config: AppConfig
  db: Db
  sessions: SessionStore
  csca: CscaService
}

/** The MRZ lookup fields a relying party supplies to check revocation. */
const documentLookup = z.object({
  documentCode: z.string().min(1).max(2).default('P'),
  issuingState: z.string().length(3),
  documentNumber: z.string().min(1).max(9),
  dateOfBirth: z.string().regex(/^\d{6}(\d{2})?$/),
})

/** Registers the PKD routes. */
export function registerPkdRoutes(app: FastifyInstance, deps: PkdRouteDeps): void {
  const server = app.withTypeProvider<ZodTypeProvider>()
  const { config, db } = deps

  server.get('/pkd/certificates', async () => {
    const items = listObjects(db, config)
      .filter((object) => object.kind === 'csca')
      .map((object) => ({
        id: object.id,
        cn: object.cn,
        subject: object.subject,
        status: object.status,
      }))
    return { total: items.length, items }
  })

  server.get('/pkd/crls', async () => {
    const items = listObjects(db, config)
      .filter((object) => object.kind === 'crl')
      .map((object) => ({ id: object.id, crlNumber: Number(object.cn) }))
    return { total: items.length, items }
  })

  server.get('/pkd/masterlists', async () => {
    const items = listObjects(db, config)
      .filter((object) => object.kind === 'ml')
      .map((object) => ({ id: object.id }))
    return { total: items.length, items }
  })

  // Authorization-PKI trust anchors (Doc 9303-12 §7.2): the CVCA certificates
  // (root and link) and the issued Document Verifier certificates.
  server.get('/pkd/cvca', async () => {
    const items = listObjects(db, config)
      .filter((object) => object.kind === 'cvca')
      .map((object) => ({
        id: object.id,
        cn: object.cn,
        subject: object.subject,
        status: object.status,
      }))
    return { total: items.length, items }
  })

  server.get('/pkd/dvs', async () => {
    const items = db
      .select()
      .from(dvCert)
      .orderBy(desc(dvCert.id))
      .all()
      .map((row) => ({
        id: `dv-${row.id}`,
        holderReference: row.holderReference,
        authorityReference: row.authorityReference,
        name: row.subjectCn,
        mnt: row.mnt,
        status: row.status,
        keyMode: row.keyMode,
        dvClass: row.dvClass,
        permissions: parsePermissions(row.permissionsJson),
        notBefore: row.notBefore,
        notAfter: row.notAfter,
      }))
    return { total: items.length, items }
  })

  // Every active or revoked Document Signer certificate, with the policy,
  // name, validity, document type and application URL published for relying
  // parties (the certificate bytes stay under /csca/certificates).
  server.get('/pkd/dscs', async () => {
    const items = db
      .select()
      .from(dscCert)
      .orderBy(desc(dscCert.id))
      .all()
      .filter(
        (row) =>
          (row.source === 'nia' || row.source === 'owned') &&
          (row.status === 'active' || row.status === 'revoked'),
      )
      .map((row) => {
        const meta = certMetadata(row)
        return {
          id: row.id,
          serial: row.serial,
          name: row.subjectDn,
          mnt: row.mnt,
          status: row.status,
          source: row.source,
          keyMode: row.keyMode,
          documentTypes: meta.documentTypes,
          issuancePolicy: row.issuancePolicy,
          applicationUrl: row.applicationUrl,
          notBefore: row.notBefore,
          notAfter: row.notAfter,
          revokedAt: row.revokedAt,
          fingerprintSha256: meta.fingerprintSha256,
        }
      })
    return { total: items.length, items }
  })

  // Public revoked-document directory (SLTD-like): the SHA-256 of each revoked
  // passport's canonical MRZ lookup fields, so a relying party hashes the
  // document it holds and compares without exposing personal data.
  server.get('/pkd/revoked', async () => {
    const items = listRevokedDocuments(db)
    return {
      total: items.length,
      algorithm: REVOKE_HASH_ALGORITHM,
      encoding: 'hex',
      fields: REVOKE_HASH_FIELDS,
      canonicalisation: REVOKE_HASH_CANONICAL,
      items,
    }
  })

  server.get(
    '/pkd/revoked/:hash',
    { schema: { params: z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/i) }) } },
    async (request) => {
      const hash = request.params.hash.toLowerCase()
      return { hash, revoked: isRevokedHash(db, hash) }
    },
  )

  // Look up a document by the MRZ fields a relying party reads from it.
  server.post(
    '/pkd/revoked/check',
    {
      schema: { body: documentLookup },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request) => {
      const document = request.body as DocumentLookup
      const hash = revokedDocumentHash(document)
      return { hash, revoked: isRevokedHash(db, hash) }
    },
  )

  server.get(
    '/pkd/objects/:id.:format',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(64), format: z.enum(['der', 'pem']) }),
      },
    },
    async (request, reply) => {
      const object = listObjects(db, config).find((entry) => entry.id === request.params.id)
      if (!object) return reply.code(404).send({ error: 'object_not_found' })
      if (request.params.format === 'pem') {
        const label = object.kind === 'crl' ? 'X509 CRL' : 'CERTIFICATE'
        return reply.type('application/x-pem-file').send(derToPem(object.der, label))
      }
      return reply.type('application/octet-stream').send(Buffer.from(object.der))
    },
  )

  server.get('/pkd/ldif', async (_request, reply) => {
    return reply.type('text/plain; charset=utf-8').send(buildLdif(db, config))
  })

  server.post(
    '/pkd/masterlists',
    { preHandler: requireAdmin(deps as unknown as AuthContext, 'csca') },
    async (request, reply) => {
      const row = await deps.csca.generateMasterList()
      writeAudit(db, {
        actorAccountId: request.principal?.account.id ?? null,
        realm: 'csca',
        action: 'pkd.masterlist.generate',
        targetType: 'master_list',
        targetId: row.id,
        ip: request.ip,
      })
      return reply.code(201).send({ id: `ml-${row.id}` })
    },
  )
}
