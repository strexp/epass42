/**
 * PKD publication scenarios: the REST directory, opaque DER/PEM downloads, the
 * revoked-document directory and the LDIF rendered for OpenLDAP.
 */
import { describe, expect, it } from 'vitest'

import { CLIENT_IDS, CVCA_ADMIN, CSCA_ADMIN, DSC_USER } from '../../fixtures/identities'
import { signRequest } from '../../fixtures/documents'
import {
  generateMasterListForTest,
  issueCscaSigner,
  issueDv,
  issuePassport,
  issueTerminal,
} from '../actions'
import { loginAs, withBackend, type Backend } from '../harness'

/**
 * Builds a deployment with every kind of published object: CSCA root + link,
 * owned and NIA DSCs, a revocation/CRL, CVCA + DV, a terminal (not published),
 * an ML signer + Master List, and a revoked passport.
 */
async function seedDirectory(backend: Backend): Promise<void> {
  const owned = await issueCscaSigner(backend, {
    subjectCn: 'Published DSC',
    documentTypes: ['P', 'ID'],
  })
  await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
  expect((await backend.client.post(`/csca/certificates/${owned.id}/revoke`, {})).status).toBe(200)

  const dv = await issueDv(backend, { subjectCn: 'Published DV' })
  expect(dv.id).toBeGreaterThan(0)
  await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_ADMIN)
  expect((await backend.client.post('/cvca/keys/rollover', { confirm: true })).status).toBe(200)

  const terminal = await issueTerminal(backend, { subjectCn: 'Published IS' })
  expect(terminal.id).toBeGreaterThan(0)

  await generateMasterListForTest(backend)

  const passport = await issuePassport(backend, signRequest())
  await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
  expect(
    (await backend.client.post(`/dsc/passports/${passport.reference}/revoke`, { reason: 'test' }))
      .status,
  ).toBe(200)
}

interface ListResponse {
  total: number
  items: { id: string | number; objectId?: string }[]
}

describe('backend e2e — PKD publication', () => {
  it('publishes every object with stable ids and DER/PEM downloads', async () => {
    await withBackend(async (backend) => {
      await seedDirectory(backend)

      const expected: Record<string, number> = {
        '/pkd/certificates': 1,
        '/pkd/crls': 1,
        '/pkd/cvca': 3,
        '/pkd/dvs': 2,
        '/pkd/dscs': 2,
        '/pkd/ml-signers': 1,
        '/pkd/masterlists': 1,
      }
      const ids: string[] = []
      for (const [path, total] of Object.entries(expected)) {
        const response = await backend.client.get(path)
        expect(response.status, path).toBe(200)
        const body = response.json<ListResponse>()
        expect(body.total, path).toBe(total)
        ids.push(...body.items.map((item) => item.objectId ?? String(item.id)))
      }
      expect(new Set(ids).size).toBe(ids.length)

      for (const id of ids) {
        const der = await backend.client.get(`/pkd/objects/${id}.der`)
        expect(der.status, id).toBe(200)
        // X.509/CMS objects are SEQUENCEs; CV certificates start with `7F21`.
        expect([0x30, 0x7f], id).toContain(der.bytes[0])
        const pem = await backend.client.get(`/pkd/objects/${id}.pem`)
        expect(pem.status, id).toBe(200)
        expect(pem.text, id).toContain('-----BEGIN ')
        expect(pem.text, id).toContain('-----END ')
      }

      const dscs = (await backend.client.get('/pkd/dscs')).json<{
        items: {
          id: number
          objectId: string
          certificateType: string
          status: string
          documentTypes: string[]
          fingerprintSha256: string
        }[]
      }>()
      expect(dscs.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            certificateType: 'dsc',
            status: 'revoked',
            documentTypes: ['P', 'ID'],
            mnt: 'USER-MNT',
          }),
        ]),
      )
      for (const item of dscs.items) {
        expect(item.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/)
        expect(item.id).not.toBeUndefined()
      }

      expect((await backend.client.get('/pkd/objects/does-not-exist.der')).status).toBe(404)
      expect((await backend.client.get('/pkd/objects/csca-1.txt')).status).toBe(400)
    })
  })

  it('publishes the revoked-document directory and answers hash lookups', async () => {
    await withBackend(async (backend) => {
      const first = await issuePassport(backend, signRequest('L898902C<'))
      // A second approval supersedes (revokes) the first document.
      const second = await issuePassport(backend, signRequest('L898902D<'))
      await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
      expect(first.reference).not.toBe(second.reference)
      expect(
        (await backend.client.get(`/dsc/requests/${first.reference}`)).json<{ status: string }>()
          .status,
      ).toBe('revoked')

      const directory = await backend.client.get('/pkd/revoked')
      expect(directory.status).toBe(200)
      const body = directory.json<{
        total: number
        algorithm: string
        encoding: string
        fields: string[]
        canonicalisation: string
        items: { hash: string; documentCode: string; revokedAt: string | null }[]
      }>()
      expect(body.total).toBe(1)
      expect(body.algorithm).toBe('sha256')
      expect(body.encoding).toBe('hex')
      expect(body.fields).toEqual(['documentCode', 'issuingState', 'documentNumber', 'dateOfBirth'])
      expect(body.canonicalisation).toContain('UPPER-CASE')
      expect(body.items[0]?.hash).toMatch(/^[0-9a-f]{64}$/)

      const hash = body.items[0]!.hash
      const byHash = await backend.client.get(`/pkd/revoked/${hash}`)
      expect(byHash.json()).toEqual({ hash, revoked: true })
      const unknown = await backend.client.get(`/pkd/revoked/${'0'.repeat(64)}`)
      expect(unknown.json()).toEqual({ hash: '0'.repeat(64), revoked: false })
      expect((await backend.client.get('/pkd/revoked/not-a-hash')).status).toBe(400)

      const check = await backend.client.post('/pkd/revoked/check', {
        documentCode: 'P',
        issuingState: 'XDN',
        documentNumber: 'L898902C<',
        dateOfBirth: '690806',
      })
      expect(check.status).toBe(200)
      expect(check.json()).toEqual({ hash, revoked: true })

      const clean = await backend.client.post('/pkd/revoked/check', {
        documentCode: 'P',
        issuingState: 'XDN',
        documentNumber: 'L898902D<',
        dateOfBirth: '690806',
      })
      expect(clean.json<{ revoked: boolean }>().revoked).toBe(false)

      // The canonical form ignores case, fillers and whitespace.
      const canonical = await backend.client.post('/pkd/revoked/check', {
        documentCode: 'P',
        issuingState: 'xdn',
        documentNumber: 'l898902c',
        dateOfBirth: '690806',
      })
      expect(canonical.json()).toEqual({ hash, revoked: true })

      expect(
        (await backend.client.post('/pkd/revoked/check', { documentNumber: 'X' })).status,
      ).toBe(400)
    })
  })

  it('renders LDIF with every PKD object class', async () => {
    await withBackend(async (backend) => {
      await seedDirectory(backend)

      const response = await backend.client.get('/pkd/ldif')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/plain')
      const ldif = response.text
      for (const fragment of [
        'dn: c=XD,dc=data,dc=download,dc=pkd,dc=icao,dc=int',
        'dn: ou=csca,',
        'dn: ou=crl,',
        'dn: ou=cvca,',
        'dn: ou=dv,',
        'dn: ou=dsc,',
        'dn: ou=ml-signer,',
        'dn: ou=masterlist,',
        'cACertificate;binary::',
        'userCertificate;binary::',
        'certificateRevocationList;binary::',
        '2.23.136.1.1.2::',
        'objectClass: 2.23.136.2',
      ]) {
        expect(ldif, fragment).toContain(fragment)
      }
      expect(ldif.endsWith('\n')).toBe(true)
      expect((await backend.client.get('/pkd/ldif')).text).toBe(ldif)
    })
  })
})
