/**
 * Cross-project e2e fixture generator (not part of the product).
 *
 * Issues CSCA -> DSC (EF.SOD), CVCA -> DV -> IS (terminal authentication) and
 * CSCA -> LDS2 Signer (LDS2 records), then builds the card42 `.perso` script
 * with the production `buildPersoSigning` helper.
 */
import { createPrivateKey } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildPersoSigning,
  mrzExpiry,
  type IssuingDefaults,
  type TaTrustAnchor,
} from '../../../backend/src/modules/dsc/build'
import {
  bytesToHex,
  certificateReference,
  createCscaRoot,
  createCvCertificate,
  createCvcaRoot,
  createDsc,
  createLds2Signer,
  cvPublicKeyOf,
  derToPem,
  generateEcKeyPair,
  generateRsaKeyPair,
  sha256,
  verifySod,
  type CvKeyPair,
  type EcKeyPair,
} from '@epass42/pki'
import { securityOptionsSchema, signRequestSchema, type DvPermissions } from '@epass42/shared'

const ROOT = import.meta.dirname
const OUT = join(ROOT, 'out-rsa')
const ASSETS = join(ROOT, '..', 'fixtures', 'assets')

/** P-256 private scalar (32 bytes) from a WebCrypto EC PKCS#8 key. */
function ecScalar(key: EcKeyPair): Uint8Array {
  const privateKey = createPrivateKey({
    key: Buffer.from(key.pkcs8),
    format: 'der',
    type: 'pkcs8',
  })
  const jwk = privateKey.export({ format: 'jwk' }) as { d?: string }
  if (!jwk.d) throw new Error('EC private key has no scalar')
  const raw = Buffer.from(jwk.d, 'base64url')
  const out = new Uint8Array(32)
  out.set(raw.subarray(Math.max(0, raw.length - 32)), 32 - Math.min(32, raw.length))
  return out
}

function yymmdd(date: Date): string {
  return (
    String(date.getUTCFullYear() % 100).padStart(2, '0') +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0')
  )
}

function hexOf(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

function write(name: string, data: string | Uint8Array): string {
  const path = join(OUT, name)
  writeFileSync(path, data)
  return path
}

const ALL_PERMISSIONS: DvPermissions = {
  epassport: { dg3: true, dg4: true },
  travel: { read: true, write: true },
  visa: { read: true, write: true },
  biometrics: { read: true, write: true },
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const now = new Date()
  const notBefore = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1))
  const notAfter = new Date(Date.UTC(now.getUTCFullYear() + 10, 0, 1))
  const crlDp = ['ldap://epass42.local/c=XD']

  // --- CSCA / DSC (LDS1 EF.SOD) -------------------------------------------
  const cscaKey = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
  const csca = await createCscaRoot(
    {
      commonName: 'ePass42 E2E CSCA',
      country: 'XD',
      locality: 'XDN',
      notBefore,
      notAfter,
      privateKeyNotAfter: notAfter,
      crlDistributionPoints: crlDp,
    },
    cscaKey,
  )
  const dscKey = await generateRsaKeyPair({ modulusLength: 2048, pss: true })
  const dsc = await createDsc(
    {
      commonName: 'ePass42 E2E DSC',
      country: 'XD',
      documentTypes: ['P', 'I'],
      notBefore,
      notAfter,
      crlDistributionPoints: crlDp,
    },
    { publicKey: dscKey.publicKey },
    { certificate: csca.certificate, key: cscaKey },
  )
  write('csca.crt', csca.pem)
  write('csca.der', csca.der)
  write('dsc.crt', dsc.pem)
  write('dsc.der', dsc.der)
  write('csca.key', derToPem(cscaKey.pkcs8, 'PRIVATE KEY'))
  write('dsc.key', derToPem(dscKey.pkcs8, 'PRIVATE KEY'))

  // --- CVCA / DV / IS (Terminal Authentication) ---------------------------
  const cvcaKey = await generateEcKeyPair('P-256')
  const dvKey = await generateEcKeyPair('P-256')
  const isKey = await generateEcKeyPair('P-256')
  const cvca = await createCvcaRoot(
    {
      country: 'XD',
      holderMnemonic: 'CVCA',
      sequence: '1',
      role: 'cvca',
      permissions: ALL_PERMISSIONS,
      notBefore,
      notAfter,
    },
    cvcaKey as CvKeyPair,
  )
  const dv = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'DV',
      sequence: '1',
      role: 'dv',
      dvClass: 'domestic',
      permissions: ALL_PERMISSIONS,
      notBefore,
      notAfter,
      publicKey: cvPublicKeyOf(dvKey as CvKeyPair),
    },
    { authorityReference: cvca.holderReference, key: cvcaKey as CvKeyPair },
  )
  const is = await createCvCertificate(
    {
      country: 'XD',
      holderMnemonic: 'IS',
      sequence: '1',
      role: 'terminal',
      permissions: ALL_PERMISSIONS,
      notBefore,
      notAfter,
      publicKey: cvPublicKeyOf(isKey as CvKeyPair),
    },
    { authorityReference: dv.holderReference, key: dvKey as CvKeyPair },
  )
  write('cvca.cvc', cvca.der)
  write('dv.cvc', dv.der)
  write('is.cvc', is.der)
  write('ta-chain.der', new Uint8Array([...dv.der, ...is.der]))
  write('ta-key.txt', hexOf(ecScalar(isKey)) + '\n')
  write('cvca-key.pem', derToPem(cvcaKey.pkcs8, 'PRIVATE KEY'))
  write('dv-key.pem', derToPem(dvKey.pkcs8, 'PRIVATE KEY'))
  write('is-key.pem', derToPem(isKey.pkcs8, 'PRIVATE KEY'))

  // --- LDS2 Signer (Travel / Visa / Biometrics) ---------------------------
  const lds2Key = await generateEcKeyPair('P-256')
  const lds2 = await createLds2Signer(
    {
      commonName: 'LDS2TS',
      country: 'XD',
      lds2Types: ['ts', 'v', 'b'],
      notBefore,
      notAfter: new Date(Date.UTC(now.getUTCFullYear() + 10, 3, 1)),
    },
    { publicKey: lds2Key.publicKey },
    { certificate: csca.certificate, key: cscaKey },
  )
  write('lds2.crt', lds2.pem)
  write('lds2.der', lds2.der)
  write('lds2.key', derToPem(lds2Key.pkcs8, 'PRIVATE KEY'))

  // --- Perso (LDS1 + empty LDS2 apps + PACE/CA/AA/TA) ---------------------
  const profile: IssuingDefaults = {
    countryAlpha3: 'XDN',
    issuingAuthority: 'XDN E2E Authority',
    personalizationDevice: 'pkd42 e2e',
    dg13Policy: '',
    validityYears: 10,
    dg2MaxBytes: 20000,
    lds2: { enabled: true, roles: ['travel', 'visa', 'biometrics'] },
    security: securityOptionsSchema.parse({
      pace: { ecdhGm3des: true, ecdhGmAes128: true },
      aa: { enabled: true, algorithm: 'ecdsa' },
      ca: { enabled: true, keyId: 1 },
      ta: { enabled: true },
    }),
  }

  const jpeg = readFileSync(join(ASSETS, 'dg2.jpg'))
  // Inner DG3/DG4 templates from the card42 sample script (7F61 group).
  const dg3Inner = Buffer.from(
    '7F611D0201017F60175F2E140102030405060708090A0B0C0D0E0F1011121314',
    'hex',
  )
  const dg4Inner = Buffer.from('7F61190201017F60135F2E102122232425262728292A2B2C2D2E2F30', 'hex')
  const request = signRequestSchema.parse({
    mrz: {
      documentCode: 'P',
      issuingState: 'XDN',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      documentNumber: 'L898902C<',
      nationality: 'XDN',
      dateOfBirth: '690806',
      sex: 'F',
      dateOfExpiry: mrzExpiry(profile.validityYears),
      personalNumber: '',
      optionalData: '',
    },
    can: '123456',
    dg2: { jpeg: jpeg.toString('base64'), width: 240, height: 300 },
    dg3: { bytes: dg3Inner.toString('base64') },
    dg4: { bytes: dg4Inner.toString('base64') },
    dg11: {
      fullName: 'ERIKSSON ANNA MARIA',
      personalNumber: 'XDN0000001',
      placeOfBirth: 'STOCKHOLM',
      address: '1 TEST STREET',
    },
    dg12: { otherPersons: ['TEST PERSON'], taxExit: 'NONE' },
    dg13: { text: 'pkd42 x card42 LDS2 e2e' },
    dg16: { persons: [{ name: 'CONTACT PERSON', telephone: '+41000000000' }] },
  })

  const trustAnchor: TaTrustAnchor = {
    car: cvca.holderReference,
    effective: yymmdd(cvca.effectiveDate),
    authorization: ALL_PERMISSIONS,
    publicKey: cvcaKey.point,
  }

  const built = await buildPersoSigning(
    request,
    profile,
    { certPem: dsc.pem, keyPair: dscKey as CvKeyPair, hash: 'SHA-256' },
    trustAnchor,
  )
  const sod = await verifySod(
    built.sod,
    new Map(built.groups.map((group) => [group.number, group.bytes])),
  )
  if (!sod.valid) throw new Error(`SOD self-check failed: ${sod.errors.join('; ')}`)
  // LDS2 sections intentionally carry no PACE credentials: card42 stores
  // f(MRZ)/f(CAN) package-wide, so the LDS1 section personalizes them once.
  write('perso.txt', built.perso)

  const metadata = {
    generatedAt: new Date().toISOString(),
    perso: 'perso.txt',
    sha256: bytesToHex(sha256(new TextEncoder().encode(built.perso))),
    dataGroups: built.pairs,
    persoBytes: Buffer.byteLength(built.perso),
    dscSerial: dsc.serialHex,
    lds2SignerSerial: lds2.serialHex,
    lds2SignerDerBytes: lds2.der.length,
    cvcaReference: cvca.holderReference,
    dvReference: dv.holderReference,
    isReference: is.holderReference,
    trustPointCar: trustAnchor.car,
    trustPointAuthorization: hexOf(
      new Uint8Array([
        (ALL_PERMISSIONS.epassport.dg3 ? 1 : 0) | (ALL_PERMISSIONS.epassport.dg4 ? 2 : 0),
        0x0f,
        0x0f,
        0x0f,
      ]),
    ),
    expected: {
      documentNumber: request.mrz.documentNumber,
      dateOfBirth: request.mrz.dateOfBirth,
      dateOfExpiry: request.mrz.dateOfExpiry,
      can: request.can,
      holderReferences: {
        cvca: certificateReference('XD', 'CVCA', '1'),
        dv: certificateReference('XD', 'DV', '1'),
        is: certificateReference('XD', 'IS', '1'),
      },
    },
  }
  write('metadata.json', JSON.stringify(metadata, null, 2))

  // --- card42 LDS2 append specs ------------------------------------------
  write(
    'append-cert.json',
    JSON.stringify({ type: 'certificate', certificateFile: join(OUT, 'lds2.crt') }, null, 2),
  )
  write(
    'append-entry.json',
    JSON.stringify(
      {
        type: 'entry',
        state: 'XDN',
        travelDate: '20261020',
        inspectionAuthority: 'XDN',
        inspectionLocation: 'XDN',
        inspectorReference: 'XDN00001',
        modeOfTravel: 'A',
        certificateReference: 1,
      },
      null,
      2,
    ),
  )
  write(
    'append-visa.json',
    JSON.stringify(
      {
        type: 'visa',
        issuingState: 'XDN',
        documentType: 'VS',
        placeOfIssue: 'XDN',
        effectiveDate: '20260101',
        expirationDate: '20270101',
        documentNumber: 'V1234567',
        name: 'ERIKSSON ANNA MARIA',
        surname: 'ERIKSSON',
        givenNames: 'ANNA MARIA',
        sex: 'F',
        dateOfBirth: '690806',
        nationality: 'XDN',
        mrz: 'V<XDNV1234567<<ERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<',
        certificateReference: 1,
      },
      null,
      2,
    ),
  )
  write(
    'append-biometrics.json',
    JSON.stringify(
      {
        type: 'biometrics',
        biometricsHex: '7F611002010102020304050608010A0B0C0D0E0F10',
        certificateReference: 1,
      },
      null,
      2,
    ),
  )

  console.log(JSON.stringify(metadata, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
