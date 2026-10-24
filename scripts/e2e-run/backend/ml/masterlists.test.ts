/**
 * Master List realm scenarios: signer bootstrap/status/rotation, signed Master
 * List generation, PKD publication and the CSCA/signer lifecycle gates.
 */
import { describe, expect, it } from 'vitest'

import { CMS_OIDS } from '@epass42/pki'

import { parseMasterList } from '../../fixtures/cms'
import { CLIENT_IDS, CSCA_ADMIN, ML_ADMIN, ML_USER } from '../../fixtures/identities'
import { expireCsca, expireMlSigner } from '../actions'
import { loginAs, withBackend, type Backend } from '../harness'

interface MlStatus {
  signer: { id: number; serial: string; status: string; fingerprintSha256: string } | null
  latestMasterList: {
    id: number
    objectId: string
    signerId: number | null
    signerSerial: string | null
  } | null
  canGenerateMasterList: boolean
  canRotateSigner: boolean
  csca: { id: number; serial: string; expired: boolean } | null
}

/** Generates a Master List as the signed-in ML administrator. */
async function generateMasterList(backend: Backend): Promise<{ id: string; signerId: number }> {
  const response = await backend.client.post('/ml/masterlists', { confirm: true })
  expect(response.status).toBe(201)
  return response.json<{ id: string; signerId: number }>()
}

describe('backend e2e — Master List lifecycle', () => {
  it('exposes the signer status to ML administrators only', async () => {
    await withBackend(async (backend) => {
      expect((await backend.client.get('/ml/status')).status).toBe(401)

      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_USER)
      expect((await backend.client.get('/ml/status')).status).toBe(403)

      const cscaClient = backend.createClient()
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN, cscaClient)
      expect((await cscaClient.get('/ml/status')).status).toBe(401)

      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const status = await backend.client.get('/ml/status')
      expect(status.status).toBe(200)
      const body = status.json<MlStatus>()
      expect(body.signer).not.toBeNull()
      expect(body.signer?.status).toBe('active')
      expect(body.signer?.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(body.canGenerateMasterList).toBe(true)
      expect(body.canRotateSigner).toBe(true)
      expect(body.csca?.expired).toBe(false)
      expect(body.latestMasterList).toBeNull()

      // The signer is public in the PKD, but not a Document Signer.
      const signers = await backend.client.get('/pkd/ml-signers')
      expect(signers.json<{ items: { id: string; status: string }[] }>().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `ml-signer-${body.signer!.id}`, status: 'active' }),
        ]),
      )
      const dscs = await backend.client.get('/pkd/dscs')
      expect(dscs.json<{ items: { id: number }[] }>().items.map((item) => item.id)).not.toContain(
        body.signer!.id,
      )
      const cscaList = await backend.client.get('/csca/certificates')
      expect(
        cscaList.json<{ items: { id: number }[] }>().items.map((item) => item.id),
      ).not.toContain(body.signer!.id)
    })
  })

  it('generates a signed CSCA Master List and publishes it', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      expect((await backend.client.post('/ml/masterlists', { confirm: false })).status).toBe(400)

      const created = await generateMasterList(backend)
      expect(created.id).toBe('ml-1')
      expect(created.signerId).toBeGreaterThan(0)

      const object = await backend.client.get('/pkd/objects/ml-1.der')
      expect(object.status).toBe(200)
      const masterList = await parseMasterList(object.bytes)
      expect(masterList.contentType).toBe(CMS_OIDS.signedData)
      expect(masterList.eContentType).toBe(CMS_OIDS.cscaMasterList)
      expect(masterList.signerCount).toBe(1)
      expect(masterList.signatureValid).toBe(true)
      // Only the signer certificate is embedded before any CSCA rollover.
      expect(masterList.certificateCount).toBe(2)

      const list = await backend.client.get('/pkd/masterlists')
      const items = list.json<{ total: number; items: { id: string; latest: boolean }[] }>()
      expect(items.total).toBe(1)
      expect(items.items[0]).toMatchObject({ id: 'ml-1', latest: true })

      const status = (await backend.client.get('/ml/status')).json<MlStatus>()
      expect(status.latestMasterList).toMatchObject({
        id: 1,
        objectId: 'ml-1',
        signerId: created.signerId,
      })
      expect(status.latestMasterList?.signerSerial).toBeTruthy()
    })
  })

  it('rotates the signer and signs subsequent Master Lists with the new key', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const before = (await backend.client.get('/ml/status')).json<MlStatus>()

      const rotated = await backend.client.post('/ml/signers/rotate', { confirm: true })
      expect(rotated.status).toBe(200)
      const ids = rotated.json<{ previous: number | null; current: number }>()
      expect(ids.previous).toBe(before.signer?.id)
      expect(ids.current).not.toBe(ids.previous)

      const after = (await backend.client.get('/ml/status')).json<MlStatus>()
      expect(after.signer).toMatchObject({ id: ids.current, status: 'active' })
      expect(after.latestMasterList).toBeNull()

      const signers = (await backend.client.get('/pkd/ml-signers')).json<{
        items: { id: string; status: string }[]
      }>()
      expect(signers.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: `ml-signer-${ids.previous}`, status: 'retired' }),
          expect.objectContaining({ id: `ml-signer-${ids.current}`, status: 'active' }),
        ]),
      )

      const created = await generateMasterList(backend)
      const masterList = await parseMasterList(
        (await backend.client.get(`/pkd/objects/${created.id}.der`)).bytes,
      )
      expect(masterList.signatureValid).toBe(true)
      expect(created.signerId).toBe(ids.current)
    })
  })

  it('includes every CSCA certificate after a key rollover', async () => {
    await withBackend(async (backend) => {
      await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
      const rollover = await backend.client.post('/csca/keys/rollover', { confirm: true })
      expect(rollover.status).toBe(200)

      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const created = await generateMasterList(backend)
      const masterList = await parseMasterList(
        (await backend.client.get(`/pkd/objects/${created.id}.der`)).bytes,
      )
      // One signer certificate plus the retired root, link and new root.
      expect(masterList.certificateCount).toBe(4)
      expect(masterList.signatureValid).toBe(true)
    })
  })

  it('blocks generation with an expired signer and rotation with an expired CSCA', async () => {
    await withBackend(async (backend) => {
      expireMlSigner(backend)
      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const status = (await backend.client.get('/ml/status')).json<MlStatus>()
      expect(status.canGenerateMasterList).toBe(false)
      const generate = await backend.client.post('/ml/masterlists', { confirm: true })
      expect(generate.status).toBe(409)
      expect(generate.json<{ error: string }>().error).toBe('ml_signer_expired')
    })

    await withBackend(async (backend) => {
      expireCsca(backend)
      await loginAs(backend, 'ml', CLIENT_IDS.ml, ML_ADMIN)
      const status = (await backend.client.get('/ml/status')).json<MlStatus>()
      expect(status.canRotateSigner).toBe(false)
      expect(status.csca?.expired).toBe(true)
      const rotate = await backend.client.post('/ml/signers/rotate', { confirm: true })
      expect(rotate.status).toBe(409)
      expect(rotate.json<{ error: string }>().error).toBe('csca_expired')
    })
  })
})
