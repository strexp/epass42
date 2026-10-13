import { execFileSync } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  buildMasterList,
  buildSod,
  createCrl,
  createDsc,
  createMasterListSigner,
  derToPem,
  generateRsaKeyPair,
  importRsaKeyPair,
  parseCertificatePem,
  sha256,
} from '@epass42/pki'

const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))
const GEN = fileURLToPath(new URL('./gen-csca.ts', import.meta.url))
const VERIFY = fileURLToPath(new URL('./verify.ts', import.meta.url))

function run(args: string[], env: NodeJS.ProcessEnv = {}): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(TSX, args, {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })
    return { status: 0, stdout }
  } catch (error) {
    const err = error as { status?: number; stdout?: string }
    return { status: err.status ?? 1, stdout: err.stdout ?? '' }
  }
}

function decryptKey(pem: string, passphrase: string): Uint8Array {
  const key = createPrivateKey({ key: pem, format: 'pem', passphrase })
  return new Uint8Array(key.export({ format: 'der', type: 'pkcs8' }))
}

describe('M2 scripts end to end', () => {
  it('generates a CSCA, issues a DSC and verifies both', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epass42-scripts-'))
    const generated = run(
      [GEN, '--out', dir, '--cn', 'ePass 42 E2E CSCA', '--key-rsa-bits', '2048'],
      {
        EPASS42_KEY_PASSPHRASE: 'e2e-passphrase',
      },
    )
    expect(generated.status).toBe(0)

    const cscaPem = readFileSync(join(dir, 'csca.crt'), 'utf8')
    const cscaKeyPem = readFileSync(join(dir, 'csca.key'), 'utf8')
    const cscaCert = parseCertificatePem(cscaPem)
    const caKey = await importRsaKeyPair(decryptKey(cscaKeyPem, 'e2e-passphrase'), false)

    const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const now = new Date('2026-10-08T00:00:00Z')
    const dsc = await createDsc(
      {
        commonName: 'ePass 42 E2E DSC',
        documentTypes: ['P'],
        notBefore: now,
        notAfter: new Date('2036-10-08T00:00:00Z'),
        privateKeyNotAfter: new Date('2027-01-08T00:00:00Z'),
        crlDistributionPoints: ['ldap://epass42.local/c=XD'],
        pss: false,
      },
      dscKey,
      { certificate: cscaCert, key: caKey },
    )
    const dscPath = join(dir, 'dsc.crt')
    writeFileSync(dscPath, dsc.pem)
    writeFileSync(join(dir, 'dsc.key'), derToPem(dscKey.pkcs8, 'PRIVATE KEY'))

    const profile = run([VERIFY, 'cert', dscPath, '--kind', 'dsc', '--ca', join(dir, 'csca.crt')])
    expect(profile.status).toBe(0)
    expect(profile.stdout).toContain('ok: dsc certificate')

    const chain = run([VERIFY, 'chain', dscPath, '--ca', join(dir, 'csca.crt')])
    expect(chain.status).toBe(0)

    const bad = run([VERIFY, 'cert', join(dir, 'csca.crt'), '--kind', 'dsc'])
    expect(bad.status).not.toBe(0)
    expect(bad.stdout).toContain('error:')
  }, 120_000)

  it('verifies a CRL, EF.SOD and Master List', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'epass42-scripts-'))
    const generated = run(
      [GEN, '--out', dir, '--cn', 'ePass 42 E2E CSCA', '--key-rsa-bits', '2048'],
      {
        EPASS42_KEY_PASSPHRASE: 'e2e-passphrase',
      },
    )
    expect(generated.status).toBe(0)

    const cscaCert = parseCertificatePem(readFileSync(join(dir, 'csca.crt'), 'utf8'))
    const caKey = await importRsaKeyPair(
      decryptKey(readFileSync(join(dir, 'csca.key'), 'utf8'), 'e2e-passphrase'),
      false,
    )
    const now = new Date('2026-10-08T00:00:00Z')

    const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const dsc = await createDsc(
      {
        commonName: 'ePass 42 E2E DSC',
        documentTypes: ['P'],
        notBefore: now,
        notAfter: new Date('2036-10-08T00:00:00Z'),
        crlDistributionPoints: ['ldap://epass42.local/c=XD'],
        pss: false,
      },
      dscKey,
      { certificate: cscaCert, key: caKey },
    )

    const crl = await createCrl({
      issuerCertificate: cscaCert,
      signingKey: caKey,
      crlNumber: 1,
      thisUpdate: now,
      nextUpdate: new Date('2026-11-08T00:00:00Z'),
      entries: [{ serialHex: dsc.serialHex, revocationDate: now }],
    })
    const crlPath = join(dir, 'csca.crl.der')
    writeFileSync(crlPath, crl.der)
    const crlCheck = run([VERIFY, 'crl', crlPath, '--ca', join(dir, 'csca.crt')])
    expect(crlCheck.status).toBe(0)
    expect(crlCheck.stdout).toContain('revoked=1')

    const dg1 = new Uint8Array([1, 2, 3, 4])
    const sod = await buildSod([{ number: 1, hash: sha256(dg1) }], dsc.der, dscKey.privateKey)
    const sodPath = join(dir, 'ef-sod.der')
    const dg1Path = join(dir, 'dg1.bin')
    writeFileSync(sodPath, sod)
    writeFileSync(dg1Path, dg1)
    const sodCheck = run([
      VERIFY,
      'sod',
      sodPath,
      '--ca',
      join(dir, 'csca.crt'),
      '--dg',
      `1=${dg1Path}`,
    ])
    expect(sodCheck.status).toBe(0)
    expect(sodCheck.stdout).toContain('ok: EF.SOD')

    const mlKey = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
    const mlSigner = await createMasterListSigner(
      {
        commonName: 'ePass 42 E2E ML Signer',
        documentTypes: ['P'],
        notBefore: now,
        notAfter: new Date('2036-10-08T00:00:00Z'),
        crlDistributionPoints: ['ldap://epass42.local/c=XD'],
        pss: false,
      },
      mlKey,
      { certificate: cscaCert, key: caKey },
    )
    const masterList = await buildMasterList({
      cscaCertificates: [new Uint8Array(cscaCert.rawData)],
      signerCertificate: mlSigner.der,
      signerPrivateKey: mlKey.privateKey,
    })
    const mlPath = join(dir, 'masterlist.cms')
    writeFileSync(mlPath, masterList)
    const mlCheck = run([VERIFY, 'ml', mlPath])
    expect(mlCheck.status).toBe(0)
    expect(mlCheck.stdout).toContain('ok: Master List')
  }, 120_000)
})
