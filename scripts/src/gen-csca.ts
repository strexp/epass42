#!/usr/bin/env node
/**
 * `pkd42-gen-csca` — generate a conforming ICAO Doc 9303-12 CSCA root.
 *
 * The certificate is built with `@pkd42/pki` (not `openssl req`), because the
 * profile requires the PrivateKeyUsagePeriod extension that `openssl req` does
 * not support.  Outputs:
 *
 *   csca.key   encrypted PKCS#8 private key (interactive passphrase)
 *   csca.crt   certificate, PEM
 *   csca.crt.der  certificate, DER
 *   csca.json  metadata (serial, SKI, SHA-256 fingerprint, dates)
 */
import { createPrivateKey } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

import { createCscaRoot, generateRsaKeyPair, type HashName, type RsaKeyPair } from '@pkd42/pki'
import { COUNTRY_ALPHA2, COUNTRY_ALPHA3, DISCLAIMER } from '@pkd42/shared'

const HASHES: Record<string, HashName> = {
  sha224: 'SHA-224',
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512',
}

interface Options {
  out: string
  cn: string
  country: string
  locality: string
  state?: string
  validityYears: number
  privateKeyUsageYears: number
  keyRsaBits: number
  hash: HashName
  pss: boolean
  crlDp: string[]
  passphrase?: string
}

function usage(): string {
  return `Usage: pkd42-gen-csca [options]

Options:
  --out <dir>                    output directory (default: .)
  --cn <name>                    common name (required)
  --country <code>               country alpha-2 (default: ${COUNTRY_ALPHA2})
  --locality <name>              SAN localityName (default: ${COUNTRY_ALPHA3})
  --state <name>                 SAN stateOrProvinceName (optional)
  --validity-years <n>           certificate validity in years (default: 13)
  --private-key-usage-years <n>  private key usage period in years (default: 4)
  --key-rsa-bits <n>             RSA modulus size (default: 4096)
  --hash <sha224|sha256|sha384|sha512>  default: sha256
  --pss                          use RSASSA-PSS (default: PKCS#1 v1.5)
  --crl-dp <uri>                 CRL distribution point (repeatable)
  --passphrase <text>            key passphrase (otherwise prompted / env)
  -h, --help                     show this help
`
}

function parseOptions(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', default: '.' },
      cn: { type: 'string' },
      country: { type: 'string', default: COUNTRY_ALPHA2 },
      locality: { type: 'string', default: COUNTRY_ALPHA3 },
      state: { type: 'string' },
      'validity-years': { type: 'string', default: '13' },
      'private-key-usage-years': { type: 'string', default: '4' },
      'key-rsa-bits': { type: 'string', default: '4096' },
      hash: { type: 'string', default: 'sha256' },
      pss: { type: 'boolean', default: false },
      'crl-dp': { type: 'string', multiple: true },
      passphrase: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  })

  if (values.help) {
    process.stdout.write(usage())
    process.exit(0)
  }
  if (!values.cn) {
    process.stderr.write('error: --cn is required\n')
    process.exit(2)
  }
  const hashKey = values.hash.toLowerCase()
  const hash = HASHES[hashKey]
  if (!hash) {
    process.stderr.write(`error: unsupported hash: ${values.hash}\n`)
    process.exit(2)
  }
  const country = values.country.toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    process.stderr.write('error: --country must be two uppercase letters\n')
    process.exit(2)
  }

  return {
    out: values.out,
    cn: values.cn,
    country,
    locality: values.locality,
    state: values.state,
    validityYears: Number(values['validity-years']),
    privateKeyUsageYears: Number(values['private-key-usage-years']),
    keyRsaBits: Number(values['key-rsa-bits']),
    hash,
    pss: values.pss as boolean,
    crlDp: values['crl-dp'] ?? [`ldap://pkd42.local/c=${country}`],
    passphrase: values.passphrase ?? process.env.PKD42_KEY_PASSPHRASE,
  }
}

function addYears(date: Date, years: number): Date {
  const out = new Date(date)
  out.setUTCFullYear(out.getUTCFullYear() + years)
  return out
}

/** Prompts for a passphrase with echo disabled when reading from a TTY. */
async function promptPassphrase(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((resolve) => {
    const stdin = process.stdin as NodeJS.ReadStream & { isRaw?: boolean }
    rl.question('Passphrase for csca.key: ', (answer) => {
      rl.close()
      if (stdin.isTTY) process.stdout.write('\n')
      resolve(answer)
    })
  })
}

/** Encrypts a PKCS#8 DER key as a PEM (PBES2/AES-256) or plain when empty. */
function encryptKey(pkcs8: Uint8Array, passphrase: string): string {
  const key = createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' })
  if (passphrase === '') {
    process.stderr.write('warning: writing an UNENCRYPTED private key\n')
    return key.export({ type: 'pkcs8', format: 'pem' }) as string
  }
  return key.export({
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase,
  }) as string
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const now = new Date()
  const notBefore = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const notAfter = addYears(notBefore, options.validityYears)
  const privateKeyNotAfter = addYears(notBefore, options.privateKeyUsageYears)

  process.stderr.write(`Generating ${options.keyRsaBits}-bit RSA key...\n`)
  const key: RsaKeyPair = await generateRsaKeyPair({
    modulusLength: options.keyRsaBits,
    pss: options.pss,
    hash: options.hash,
  })

  const generated = await createCscaRoot(
    {
      commonName: options.cn,
      country: options.country,
      locality: options.locality,
      state: options.state,
      notBefore,
      notAfter,
      privateKeyNotAfter,
      crlDistributionPoints: options.crlDp,
      pss: options.pss,
      hash: options.hash,
    },
    key,
  )

  let passphrase = options.passphrase
  if (passphrase === undefined) {
    passphrase = process.stdin.isTTY ? await promptPassphrase() : ''
  }

  mkdirSync(options.out, { recursive: true })
  const keyPem = encryptKey(key.pkcs8, passphrase)
  writeFileSync(join(options.out, 'csca.key'), keyPem, { mode: 0o600 })
  writeFileSync(join(options.out, 'csca.crt'), generated.pem)
  writeFileSync(join(options.out, 'csca.crt.der'), generated.der)

  const ski = generated.certificate.getExtension('2.5.29.14') as { keyId?: string } | null
  const metadata = {
    subject: generated.certificate.subject,
    issuer: generated.certificate.issuer,
    serialHex: generated.serialHex,
    subjectKeyIdentifier: ski?.keyId ?? null,
    sha256Fingerprint: generated.fingerprintSha256,
    keyAlgorithm: options.pss ? 'RSASSA-PSS' : 'RSASSA-PKCS1-v1_5',
    hash: options.hash,
    modulusBits: options.keyRsaBits,
    notBefore: generated.certificate.notBefore.toISOString(),
    notAfter: generated.certificate.notAfter.toISOString(),
    crlDistributionPoints: options.crlDp,
    disclaimer: DISCLAIMER,
  }
  writeFileSync(join(options.out, 'csca.json'), `${JSON.stringify(metadata, null, 2)}\n`)

  process.stderr.write(
    `Wrote ${join(options.out, 'csca.key')}, csca.crt, csca.crt.der and csca.json\n` +
      `${DISCLAIMER}\n`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`error: ${(error as Error).message}\n`)
  process.exit(1)
})
