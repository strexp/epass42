#!/usr/bin/env node
/**
 * `epass42-verify` — validate CSCA/DSC certificates, CRLs, Master Lists and
 * EF.SOD against the ICAO Doc 9303-12 / Doc 9303-10 profiles.
 *
 * Exit code 0 means success; otherwise the failure is printed as
 * `error: <message>` and the process exits non-zero.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import {
  CMS_OIDS,
  crlFingerprint,
  parseCertificate,
  parseCrl,
  readCrlNumber,
  toArrayBuffer,
  validateCertProfile,
  verifyDscAgainstCsca,
  verifySod,
  type CertKind,
} from '@epass42/pki'
import * as pkijs from 'pkijs'

const USAGE = `Usage: epass42-verify <command> <file> [options]

Commands:
  cert <file>     validate a certificate profile (use --kind)
  chain <dsc>     verify a DSC chain (requires --ca)
  crl <file>      verify a CRL signature (requires --ca)
  ml <file>       verify a CSCA Master List signature
  sod <file>      verify an EF.SOD signature (and chain with --ca)

Options:
  --kind <csca|dsc|ml-signer>   certificate profile (cert)
  --ca <file>                   issuing/trusted certificate (PEM or DER)
  --dg <n=file>                 data group for SOD hash checking (repeatable)
  -h, --help
`

function fail(message: string): never {
  process.stdout.write(`error: ${message}\n`)
  process.exit(1)
}

function readBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

function loadCertificate(path: string) {
  return parseCertificate(readBytes(path))
}

async function verifyCert(path: string, kind: CertKind, caPath?: string): Promise<void> {
  const certificate = loadCertificate(path)
  const result = validateCertProfile(certificate, kind)
  if (!result.valid) {
    fail(`${kind} certificate profile deviations:\n  - ${result.errors.join('\n  - ')}`)
  }
  process.stdout.write(`ok: ${kind} certificate ${certificate.subject}\n`)
  if (caPath && kind === 'dsc') {
    const ca = loadCertificate(caPath)
    const chain = await verifyDscAgainstCsca(certificate, [ca])
    if (!chain.valid) fail(`chain: ${chain.errors.join('; ')}`)
    process.stdout.write('ok: DSC chains to the supplied CSCA\n')
  }
}

/** Verifies the chain with `openssl verify -CAfile` (Doc 9303-12 §7.1.1). */
function verifyChain(dscPath: string, caPath?: string): void {
  if (!caPath) fail('chain requires --ca')
  const result = spawnSync('openssl', ['verify', '-CAfile', caPath, dscPath], {
    encoding: 'utf8',
  })
  if (result.error) fail(`openssl not available: ${result.error.message}`)
  if (result.status !== 0) fail(result.stderr.trim() || result.stdout.trim())
  process.stdout.write(result.stdout)
}

async function verifyCrlCommand(path: string, caPath?: string): Promise<void> {
  const crl = parseCrl(readBytes(path))
  if (caPath) {
    const ca = loadCertificate(caPath)
    const ok = await crl.verify({ publicKey: ca.publicKey })
    if (!ok) fail('CRL signature does not verify against the CSCA key')
    const number = readCrlNumber(crl)
    process.stdout.write(
      `ok: CRL ${crlFingerprint(crl)} number=${number ?? '?'} revoked=${crl.entries.length}\n`,
    )
  } else {
    process.stdout.write(`CRL issuer=${crl.issuer} revoked=${crl.entries.length}\n`)
    process.stdout.write('(no --ca supplied; signature not checked)\n')
  }
}

async function verifyMasterList(path: string): Promise<void> {
  const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(readBytes(path)))
  const signedData = new pkijs.SignedData({ schema: contentInfo.content })
  if (signedData.encapContentInfo.eContentType !== CMS_OIDS.cscaMasterList) {
    fail(`eContentType is ${signedData.encapContentInfo.eContentType}, expected cscaMasterList`)
  }
  const eContent = signedData.encapContentInfo.eContent
  if (!eContent) fail('Master List has no eContent')
  const eContentBytes = toArrayBuffer(new Uint8Array(eContent.valueBlock.valueHexView))
  const ok = await signedData.verify({ signer: 0, data: eContentBytes, checkChain: false })
  if (!ok) fail('Master List signature verification failed')
  process.stdout.write(
    `ok: Master List signed by ${signedData.certificates?.length ?? 0} cert(s)\n`,
  )
}

async function verifySodCommand(
  path: string,
  caPath: string | undefined,
  dgSpecs: string[],
): Promise<void> {
  const dgHashes = new Map<number, Uint8Array>()
  for (const spec of dgSpecs) {
    const [numberText, dgPath] = spec.split('=')
    const number = Number(numberText)
    if (!Number.isInteger(number) || !dgPath) fail(`invalid --dg value: ${spec}`)
    dgHashes.set(number, readBytes(dgPath))
  }
  const caList = caPath ? [loadCertificate(caPath)] : undefined
  const result = await verifySod(readBytes(path), dgHashes.size > 0 ? dgHashes : undefined, caList)
  if (!result.valid) fail(result.errors.join('; '))
  process.stdout.write(
    `ok: EF.SOD signer=${result.signerCertificate?.subject ?? '?'} dg=${result.hashes?.length ?? 0}\n`,
  )
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      kind: { type: 'string' },
      ca: { type: 'string' },
      dg: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  })

  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE)
    process.exit(values.help ? 0 : 2)
  }

  const command = positionals[0]
  const file = positionals[1]
  if (!file) fail('missing <file>')

  switch (command) {
    case 'cert':
      await verifyCert(file, (values.kind as CertKind) ?? 'csca', values.ca)
      break
    case 'chain':
      verifyChain(file, values.ca)
      break
    case 'crl':
      await verifyCrlCommand(file, values.ca)
      break
    case 'ml':
      await verifyMasterList(file)
      break
    case 'sod':
      await verifySodCommand(file, values.ca, values.dg ?? [])
      break
    default:
      fail(`unknown command: ${command}`)
  }
}

main().catch((error: unknown) => fail((error as Error).message))
