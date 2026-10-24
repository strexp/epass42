/**
 * PKD REST surface (M9/T9.2, Appendix D):
 * `GET /pkd/{certificates,crls,masterlists,ml-signers,dscs,revoked,revoked/:hash,ldif}`,
 * `POST /pkd/revoked/check`, `GET /pkd/objects/:id.:format`.
 */
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { derToPem, parseCertificatePem, sha256 } from '@epass42/pki'
import { documentIssueTypeSchema } from '@epass42/shared'
import type { AppConfig } from '../../config'
import type { Db } from '../../db/client'
import { dscCert, dvCert, masterList } from '../../db/schema'
import { certMetadata } from '../csca/routeContext'
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
}

/** The MRZ lookup fields a relying party supplies to check revocation. */
const documentLookup = z.object({
  documentCode: documentIssueTypeSchema.default('P'),
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
        cscaKeyId: object.cscaKeyId,
        cn: object.cn,
        subject: object.subject,
        status: object.status,
      }))
    return { total: items.length, items }
  })

  server.get('/pkd/crls', async () => {
    const items = listObjects(db, config)
      .filter((object) => object.kind === 'crl')
      .map((object) => ({
        id: object.id,
        crlNumber: Number(object.cn),
        cscaKeyId: object.cscaKeyId,
        cscaSerial: object.cscaSerial,
        cscaSubject: object.cscaSubject,
        thisUpdate: object.thisUpdate,
        nextUpdate: object.nextUpdate,
      }))
    return { total: items.length, items }
  })

  server.get('/pkd/masterlists', async () => {
    const rows = db.select().from(masterList).orderBy(desc(masterList.id)).all()
    const latestId = rows[0]?.id
    const items = rows.map((row) => ({
      id: `ml-${row.id}`,
      latest: row.id === latestId,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
    }))
    return { total: items.length, items }
  })

  // Master List Signer certificates are published for relying parties (active
  // and retired) but are not Document Signers.
  server.get('/pkd/ml-signers', async () => {
    const items = db
      .select()
      .from(dscCert)
      .where(eq(dscCert.source, 'ml-signer'))
      .orderBy(desc(dscCert.id))
      .all()
      .map((row) => {
        const der = new Uint8Array(parseCertificatePem(row.certPem).rawData)
        return {
          id: `ml-signer-${row.id}`,
          serial: row.serial,
          subject: row.subjectDn,
          status: row.status,
          notBefore: row.notBefore,
          notAfter: row.notAfter,
          fingerprintSha256: Buffer.from(sha256(der)).toString('hex'),
        }
      })
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
        source: row.source,
        keyMode: row.keyMode,
        dvClass: row.dvClass,
        permissions: parsePermissions(row.permissionsJson),
        notBefore: row.notBefore,
        notAfter: row.notAfter,
      }))
    return { total: items.length, items }
  })

  // Every active, revoked or retired signer certificate (DSC or LDS2 Signer),
  // with the certificate type, policy, name, validity, document type/LDS2 roles
  // and application URL published for relying parties (certificate bytes stay
  // under /csca/certificates).
  server.get('/pkd/dscs', async () => {
    const items = db
      .select()
      .from(dscCert)
      .orderBy(desc(dscCert.id))
      .all()
      .filter(
        (row) =>
          (row.source === 'nia' || row.source === 'owned') &&
          (row.status === 'active' || row.status === 'revoked' || row.status === 'retired'),
      )
      .map((row) => {
        const meta = certMetadata(row)
        return {
          id: row.id,
          objectId: `dsc-${row.id}`,
          serial: row.serial,
          name: row.subjectDn,
          mnt: row.mnt,
          status: row.status,
          source: row.source,
          keyMode: row.keyMode,
          certificateType: meta.certificateType,
          lds2Types: meta.lds2Types,
          documentTypes: meta.documentTypes,
          issuancePolicy: row.issuancePolicy,
          applicationUrl: row.applicationUrl,
          notBefore: row.notBefore,
          notAfter: row.notAfter,
          privateKeyNotAfter: meta.privateKeyNotAfter,
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
}
