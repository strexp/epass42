import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pkijs from 'pkijs'
import { describe, expect, it } from 'vitest'

import { CMS_OIDS, parseTlv, toArrayBuffer } from '@epass42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCscaKey } from '../csca/service'

const ADMIN = {
  sub: 'ml-admin',
  dn42: { asn: 4242422189, active_mnt: 'EXAMPLE-ML-MNT', mnt_by: ['EXAMPLE-ML-MNT'] },
}
const USER = {
  sub: 'ml-user',
  dn42: { asn: 4242422190, active_mnt: 'EXAMPLE-USER-MNT', mnt_by: ['EXAMPLE-USER-MNT'] },
}

async function setup(overrides: Record<string, unknown> = {}) {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { csca: { bootstrap: true }, ...overrides })
  return { built, oidc }
}

async function loginCookie(app: Awaited<ReturnType<typeof makeTestApp>>['app'], realm = 'ml') {
  const start = await app.inject({ method: 'GET', url: `/auth/${realm}/login` })
  const state = new URL(start.headers.location as string).searchParams.get('state')
  const callback = await app.inject({
    method: 'GET',
    url: `/auth/${realm}/callback?code=x&state=${state}`,
  })
  return callback.cookies.find((entry) => entry.name === `epass42_${realm}_sid`)!
}

describe('ML role', () => {
  it('bootstraps a signer and builds a signed CscaMasterList including it', async () => {
    const { built } = await setup()
    const signer = built.ml.currentSigner()
    expect(signer).toBeTruthy()
    expect(signer!.source).toBe('ml-signer')

    const row = await built.ml.generateMasterList()
    const der = new Uint8Array(row.der)
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(der))
    expect(contentInfo.contentType).toBe(CMS_OIDS.signedData)
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })
    expect(signedData.encapContentInfo.eContentType).toBe(CMS_OIDS.cscaMasterList)

    const eContent = signedData.encapContentInfo.eContent!
    const eContentBytes = toArrayBuffer(new Uint8Array(eContent.valueBlock.valueHexView))
    const ok = await signedData.verify({ signer: 0, data: eContentBytes, checkChain: false })
    expect(ok).toBe(true)

    const content = parseTlv(new Uint8Array(eContent.valueBlock.valueHexView))
    expect(content.tag).toBe(0x30)
    expect(content.children[1].tag).toBe(0x31)
    expect(content.children[1].children.length).toBeGreaterThanOrEqual(2)
    expect(currentCscaKey(built.dbHandle.db)).toBeTruthy()
    expect(row.signerDscId).toBe(signer!.id)
  })

  it('verifies with the openssl cms tool', async () => {
    const { built } = await setup()
    const row = await built.ml.generateMasterList()
    const dir = mkdtempSync(join(tmpdir(), 'epass42-ml-'))
    const path = join(dir, 'masterlist.cms')
    writeFileSync(path, new Uint8Array(row.der))

    const result = spawnSync(
      'openssl',
      ['cms', '-verify', '-inform', 'DER', '-in', path, '-noverify', '-out', '/dev/null'],
      { encoding: 'utf8' },
    )
    if (result.error) return // openssl unavailable in this environment
    expect(result.status).toBe(0)
  })

  it('honours ml.bootstrap = false until an administrator creates the signer', async () => {
    const { built } = await setup({ ml: { bootstrap: false } })
    expect(built.ml.currentSigner()).toBeUndefined()
    await expect(built.ml.generateMasterList()).rejects.toMatchObject({ code: 'ml_signer_missing' })

    const created = await built.ml.rotateSigner()
    expect(created.previous).toBeNull()
    expect(created.current.status).toBe('active')
    expect(built.ml.currentSigner()?.id).toBe(created.current.id)
  })

  it('rotates the signer and retires the previous one', async () => {
    const { built } = await setup()
    const previous = built.ml.currentSigner()!
    const result = await built.ml.rotateSigner()
    expect(result.previous?.id).toBe(previous.id)
    expect(result.current.id).not.toBe(previous.id)
    expect(built.ml.currentSigner()?.id).toBe(result.current.id)

    expect(built.ml.signers.byId(previous.id)?.status).toBe('retired')
    expect(built.ml.signers.byId(result.current.id)?.status).toBe('active')
  })

  it('enforces administrator access and protects the public PKD surface', async () => {
    const { built, oidc } = await setup()
    const { app } = built

    const anonymous = await app.inject({ method: 'GET', url: '/ml/status' })
    expect(anonymous.statusCode).toBe(401)

    oidc.set('ml-client', { subject: USER.sub, claims: USER })
    const userCookie = await loginCookie(app)
    const forbidden = await app.inject({
      method: 'GET',
      url: '/ml/status',
      headers: { cookie: `${userCookie.name}=${userCookie.value}` },
    })
    expect(forbidden.statusCode).toBe(403)

    oidc.set('ml-client', { subject: ADMIN.sub, claims: ADMIN })
    const adminCookie = await loginCookie(app)
    const status = await app.inject({
      method: 'GET',
      url: '/ml/status',
      headers: { cookie: `${adminCookie.name}=${adminCookie.value}` },
    })
    expect(status.statusCode).toBe(200)
    expect(status.json().signer).toBeTruthy()

    const rotated = await app.inject({
      method: 'POST',
      url: '/ml/signers/rotate',
      headers: { cookie: `${adminCookie.name}=${adminCookie.value}` },
      payload: { confirm: true },
    })
    expect(rotated.statusCode).toBe(200)
    expect(rotated.json().current).toBeTruthy()

    const generated = await app.inject({
      method: 'POST',
      url: '/ml/masterlists',
      headers: { cookie: `${adminCookie.name}=${adminCookie.value}` },
      payload: { confirm: true },
    })
    expect(generated.statusCode).toBe(201)
    expect(generated.json().id).toMatch(/^ml-/)

    // Public PKD reads remain available, while the old admin endpoint is gone.
    const publicList = await app.inject({ method: 'GET', url: '/pkd/masterlists' })
    expect(publicList.statusCode).toBe(200)
    const removed = await app.inject({ method: 'POST', url: '/pkd/masterlists' })
    expect(removed.statusCode).toBe(404)
  })

  it('does not list the ML signer as a CSCA-issued DSC', async () => {
    const { built, oidc } = await setup()
    oidc.set('csca-client', {
      subject: 'csca-admin',
      claims: { sub: 'csca-admin', dn42: { active_mnt: 'EXAMPLE-CSCA-MNT' } },
    })
    const { app } = built
    const cookie = await loginCookie(app, 'csca')
    const listed = await app.inject({
      method: 'GET',
      url: '/csca/certificates?includeRevoked=true',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    })
    expect(listed.statusCode).toBe(200)
    expect(
      (listed.json().items as { source: string }[]).some((item) => item.source === 'ml-signer'),
    ).toBe(false)
  })
})
