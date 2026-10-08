import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as pkijs from 'pkijs'
import { describe, expect, it } from 'vitest'

import { CMS_OIDS, parseTlv, toArrayBuffer } from '@epass42/pki'
import { FakeOidc, makeTestApp } from '../../test-support'
import { currentCscaKey } from '../csca/service'

async function setup() {
  const oidc = new FakeOidc()
  const built = await makeTestApp(oidc, { csca: { bootstrap: true } })
  return built
}

describe('M10 Master List', () => {
  it('builds a signed CscaMasterList including the signer and CSCA', async () => {
    const built = await setup()
    const row = await built.csca.generateMasterList()
    const der = new Uint8Array(row.der)

    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(der))
    expect(contentInfo.contentType).toBe(CMS_OIDS.signedData)
    const signedData = new pkijs.SignedData({ schema: contentInfo.content })
    expect(signedData.encapContentInfo.eContentType).toBe(CMS_OIDS.cscaMasterList)

    const eContent = signedData.encapContentInfo.eContent!
    const eContentBytes = toArrayBuffer(new Uint8Array(eContent.valueBlock.valueHexView))
    const ok = await signedData.verify({ signer: 0, data: eContentBytes, checkChain: false })
    expect(ok).toBe(true)

    // The signer certificate is embedded and the eContent is a SET OF
    // Certificate containing the signer and the CSCA.
    const signer = built.csca.currentMasterListSigner()
    expect(signer).toBeTruthy()
    const content = parseTlv(new Uint8Array(eContent.valueBlock.valueHexView))
    expect(content.tag).toBe(0x30)
    const certSet = content.children[1]
    expect(certSet.tag).toBe(0x31)
    expect(certSet.children.length).toBeGreaterThanOrEqual(2)
    expect(currentCscaKey(built.dbHandle.db)).toBeTruthy()
  })

  it('verifies with the openssl cms tool', async () => {
    const built = await setup()
    const row = await built.csca.generateMasterList()
    const dir = mkdtempSync(join(tmpdir(), 'epass42-ml-'))
    const path = join(dir, 'masterlist.cms')
    writeFileSync(path, new Uint8Array(row.der))

    const result = spawnSync(
      'openssl',
      ['cms', '-verify', '-inform', 'DER', '-in', path, '-noverify', '-out', '/dev/null'],
      {
        encoding: 'utf8',
      },
    )
    if (result.error) return // openssl unavailable in this environment
    expect(result.status).toBe(0)
  })
})
