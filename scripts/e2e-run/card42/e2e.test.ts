/**
 * Cross-project e2e: backend issues real CSCA/DSC/LDS2/terminal certificates,
 * the DSC realm produces the `.perso` script, and card42's simulator consumes
 * it.  The card is then read with card42's own CLI (PACE + CA + TA + PA) and
 * with the exhaustive `ReadAll` reader (all data groups, SOD hashes, TA gating).
 *
 * Disabled unless `CARD42_E2E=1`; run with:
 *   pnpm --filter @epass42/scripts test:card42
 */
import { writeFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CLIENT_IDS, CSCA_ADMIN, CVCA_USER, DSC_USER, DV_ADMIN } from '../fixtures/identities'
import { ecPrivateKeyScalar } from '../fixtures/keys'
import { MRZ, richSignRequest } from '../fixtures/documents'
import {
  allPermissions,
  approveRequest,
  issueCscaSigner,
  issueDv,
  travelReadOnly,
  submitRequest,
  submitTerminalApplication,
} from '../backend/actions'
import { loginAs, startBackend, type Backend } from '../backend/harness'
import type { RawConfig } from '../../../backend/src/config'
import {
  Card42,
  card42Paths,
  createWorkspace,
  removeWorkspace,
  startSimulator,
  type Card42Workspace,
} from './harness'

const enabled = process.env.CARD42_E2E === '1'

/** The report returned by card42's full LDS1 read. */
interface ReadReport {
  documentNumber: string
  surname: string
  givenNames: string
  nationality: string
  issuingState: string
  dateOfBirth: string
  sex: string
  dateOfExpiry: string
  faceImageBytes?: number
  ldsVersion?: string
}

/** Everything one scenario needs on disk. */
interface DocumentFixture {
  persoPath: string
  cscaPath: string
  chainPath: string
  keyHex: string
  restrictedChainPath: string
  restrictedKeyHex: string
  documentNumber: string
  dateOfBirth: string
  dateOfExpiry: string
  can: string
  expectedDataGroups: number[]
  lds2CertificatePath: string
  appendCertificate: string
  appendEntry: string
  appendVisa: string
  appendBiometrics: string
  lds2SignerKey: string
}

/** Writes a file and returns its absolute path. */
function write(workspace: Card42Workspace, name: string, data: string | Uint8Array): string {
  const path = workspace.path(name)
  writeFileSync(path, data)
  return path
}

/** Issues the terminal chain, LDS2 Signer and document through the real API. */
async function buildFixture(
  backend: Backend,
  workspace: Card42Workspace,
): Promise<DocumentFixture> {
  // 1. Terminal (Inspection System) certificate under the default DV.
  const terminalApplication = await submitTerminalApplication(backend, {
    subjectCn: 'Card42 Inspection System',
    holderMnemonic: 'CARDIS',
  })
  await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
  const terminalApprove = await backend.client.post(
    `/dv/terminal-applications/${terminalApplication}/approve`,
    {},
  )
  expect(terminalApprove.status).toBe(201)
  const terminalDetail = (
    await backend.client.get(`/dv/terminal-applications/${terminalApplication}`)
  ).json<{ signingDv: { id: number } | null }>()
  expect(terminalDetail.signingDv).not.toBeNull()

  const terminalCertificate = await backend.client.get(
    `/dv/terminal-applications/${terminalApplication}/certificate`,
  )
  expect(terminalCertificate.status).toBe(200)
  const terminalKey = await backend.client.get(
    `/dv/terminal-applications/${terminalApplication}/private-key`,
  )
  expect(terminalKey.status).toBe(200)
  const dvCertificate = await backend.client.get(
    `/cvca/certificates/${terminalDetail.signingDv!.id}.der`,
  )
  expect(dvCertificate.status).toBe(200)

  const chainPath = write(
    workspace,
    'ta-chain.der',
    new Uint8Array([...dvCertificate.bytes, ...terminalCertificate.bytes]),
  )
  const keyHex = Buffer.from(ecPrivateKeyScalar(terminalKey.text)).toString('hex')
  const cscaPath = write(workspace, 'csca.pem', backend.cscaPem())

  // 1b. A deliberately restricted terminal (Travel read only), used to prove
  // that the card still enforces the CHAT even though the main chain is broad.
  const restrictedDv = await issueDv(
    backend,
    { subjectCn: 'Restricted Card42 DV', holderMnemonic: 'RESTR' },
    { permissions: travelReadOnly() },
  )
  await loginAs(backend, 'cvca', CLIENT_IDS.cvca, CVCA_USER)
  expect((await backend.client.put('/cvca/settings/mnt', { useNiaDv: false })).status).toBe(200)
  const restrictedApplication = await submitTerminalApplication(backend, {
    subjectCn: 'Restricted Card42 IS',
    holderMnemonic: 'RESTRIS',
  })
  await loginAs(backend, 'dv', CLIENT_IDS.dv, DV_ADMIN)
  expect(
    (
      await backend.client.post(`/dv/terminal-applications/${restrictedApplication}/approve`, {
        permissions: allPermissions(),
      })
    ).status,
  ).toBe(201)
  const restrictedDetail = (
    await backend.client.get(`/dv/terminal-applications/${restrictedApplication}`)
  ).json<{ signingDv: { id: number } | null }>()
  expect(restrictedDetail.signingDv?.id).toBe(restrictedDv.id)
  const restrictedCertificate = await backend.client.get(
    `/dv/terminal-applications/${restrictedApplication}/certificate`,
  )
  const restrictedKey = await backend.client.get(
    `/dv/terminal-applications/${restrictedApplication}/private-key`,
  )
  const restrictedDvCertificate = await backend.client.get(
    `/cvca/certificates/${restrictedDv.id}.der`,
  )
  const restrictedChainPath = write(
    workspace,
    'ta-chain-restricted.der',
    new Uint8Array([...restrictedDvCertificate.bytes, ...restrictedCertificate.bytes]),
  )
  const restrictedKeyHex = Buffer.from(ecPrivateKeyScalar(restrictedKey.text)).toString('hex')

  // 2. LDS2 Signer (Travel/Visa/Biometrics) and its one-time private key.
  const lds2Signer = await issueCscaSigner(backend, {
    certificateType: 'lds2',
    subjectCn: 'LDS2TS',
    lds2Types: ['ts', 'v', 'b'],
  })
  await loginAs(backend, 'csca', CLIENT_IDS.csca, CSCA_ADMIN)
  const lds2Key = await backend.client.get(`/csca/certificates/${lds2Signer.id}/private-key`)
  expect(lds2Key.status).toBe(200)
  const lds2CertificatePath = write(workspace, 'lds2.crt', lds2Signer.certPem)
  const lds2SignerKey = write(workspace, 'lds2.key', lds2Key.text)

  // 3. The document itself: submit, approve and claim the perso script once.
  const reference = await submitRequest(backend, richSignRequest())
  await approveRequest(backend, reference)
  const detail = await backend.client.get(`/dsc/requests/${reference}/review`)
  expect(detail.status).toBe(200)
  const payload = detail.json<{
    payload: {
      mrz: { documentNumber: string; dateOfBirth: string; dateOfExpiry: string }
      can?: string
    }
  }>().payload

  await loginAs(backend, 'dsc', CLIENT_IDS.dsc, DSC_USER)
  const reveal = await backend.client.post(`/dsc/requests/${reference}/reveal`)
  expect(reveal.status).toBe(200)
  const persoPath = write(workspace, 'perso.txt', reveal.text)

  return {
    persoPath,
    cscaPath,
    chainPath,
    keyHex,
    restrictedChainPath,
    restrictedKeyHex,
    documentNumber: payload.mrz.documentNumber,
    dateOfBirth: payload.mrz.dateOfBirth,
    dateOfExpiry: payload.mrz.dateOfExpiry,
    can: payload.can ?? '123456',
    expectedDataGroups: [1, 2, 3, 4, 5, 7, 11, 12, 13, 14, 15, 16],
    lds2CertificatePath,
    appendCertificate: write(
      workspace,
      'append-cert.json',
      JSON.stringify({ type: 'certificate', certificateFile: lds2CertificatePath }),
    ),
    appendEntry: write(
      workspace,
      'append-entry.json',
      JSON.stringify({
        type: 'entry',
        state: 'XDN',
        travelDate: '20261020',
        inspectionAuthority: 'XDN',
        inspectionLocation: 'XDN',
        inspectorReference: 'XDN00001',
        modeOfTravel: 'A',
        certificateReference: 1,
      }),
    ),
    appendVisa: write(
      workspace,
      'append-visa.json',
      JSON.stringify({
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
      }),
    ),
    appendBiometrics: write(
      workspace,
      'append-biometrics.json',
      JSON.stringify({
        type: 'biometrics',
        biometricsHex: '7F611002010102020304050608010A0B0C0D0E0F10',
        certificateReference: 1,
      }),
    ),
    lds2SignerKey,
  }
}

/** One complete backend → perso → card42 run. */
async function runScenario(config: RawConfig): Promise<void> {
  const paths = card42Paths()
  if (!paths) throw new Error('card42 checkout/simulator is not available; set CARD42')
  const workspace = createWorkspace()
  const backend = await startBackend(config)
  let stopped = false
  let simulator: Awaited<ReturnType<typeof startSimulator>> | undefined
  try {
    const fixture = await buildFixture(backend, workspace)
    await backend.close()
    stopped = true

    simulator = await startSimulator(paths)
    const card = new Card42(paths, simulator, workspace)
    await card.deploy()
    await card.personalize(fixture.persoPath, {
      certificatePath: fixture.lds2CertificatePath,
      keyPath: fixture.lds2SignerKey,
    })

    const common = {
      cscaPath: fixture.cscaPath,
      chainPath: fixture.chainPath,
      keyHex: fixture.keyHex,
    }
    const mrzAuth = {
      doc: fixture.documentNumber,
      dob: fixture.dateOfBirth,
      doe: fixture.dateOfExpiry,
      ...common,
    }

    // --- LDS1: PACE-MRZ, CA, TA, PA through card42's CLI -------------------
    const lds1 = await card.read(mrzAuth)
    expect(lds1.result.code, lds1.result.stderr).toBe(0)
    expect(lds1.result.stderr).toContain('Chip Authentication: OK')
    expect(lds1.result.stderr).toContain('Terminal Authentication: OK')
    expect(lds1.result.stderr).toContain('Passive Authentication: OK')
    const report = lds1.report as unknown as ReadReport
    expect(report.documentNumber).toBe(fixture.documentNumber)
    expect(report.surname).toBe(MRZ.surname)
    expect(report.givenNames).toBe(MRZ.givenNames)
    expect(report.issuingState).toBe('XDN')
    expect(report.nationality).toBe('XDN')
    expect(report.dateOfBirth).toBe(fixture.dateOfBirth)
    expect(report.dateOfExpiry).toBe(fixture.dateOfExpiry)
    expect(report.faceImageBytes).toBeGreaterThan(0)

    // --- LDS1: PACE-CAN is a second, independent password path -------------
    const canRead = await card.read({ can: fixture.can, ...common })
    expect(canRead.result.code, canRead.result.stderr).toBe(0)
    expect((canRead.report as unknown as ReadReport).documentNumber).toBe(fixture.documentNumber)

    // --- LDS1: every DG hash and the CHAT gate ----------------------------
    const readAll = await card.readAll(mrzAuth)
    expect(readAll.code, readAll.stderr).toBe(0)
    expect(readAll.stdout).toContain('PACE: OK')
    expect(readAll.stdout).toContain('Chip Authentication: OK')
    expect(readAll.stdout).toContain('Terminal Authentication: OK')
    expect(readAll.stdout).toContain('EF.SOD: OK')
    expect(readAll.stdout).toContain('DG3 before PACE: SW=6982')
    expect(readAll.stdout).toContain('DG3 after PACE, before TA: SW=6982')
    expect(readAll.stdout).toContain(
      `present=${JSON.stringify(fixture.expectedDataGroups).replace(/,/g, ', ')}`,
    )
    expect(readAll.stdout).toContain('bad=[]')
    for (const dg of fixture.expectedDataGroups) {
      expect(readAll.stdout).toContain(`DG${dg}:`)
      expect(readAll.stdout).not.toContain(`DG${dg}: 0 B`)
    }

    // --- LDS2: empty applications inherit the card-wide PACE/CA material --
    const emptyTravel = await card.lds2Read('travel', { ...mrzAuth, record: 'all' })
    expect(emptyTravel.result.code, emptyTravel.result.stderr).toBe(0)
    // The LDS2 DF inherits the card-wide PACE/CA/TA material from the LDS1 section.
    expect(emptyTravel.result.stderr).toContain('PACE: OK (MRZ)')
    expect(emptyTravel.result.stderr).toContain('Chip Authentication: OK')
    expect(emptyTravel.result.stderr).toContain('Terminal Authentication: OK')
    expect(emptyTravel.report.securityInfos?.length).toBeGreaterThanOrEqual(2)
    expect(emptyTravel.report.recordFiles?.['EF.EntryRecords (0101)']).toHaveLength(0)
    expect(emptyTravel.report.recordFiles?.['EF.Certificates (011A)']).toHaveLength(0)

    // --- LDS2 Travel: certificate, entry record, signature verification --
    const travelCert = await card.lds2Append('travel', {
      specPath: fixture.appendCertificate,
      ...mrzAuth,
    })
    expect(travelCert.code, travelCert.stderr).toBe(0)
    expect(travelCert.stderr).toContain('certificate record #1')

    const travelEntry = await card.lds2Append('travel', {
      specPath: fixture.appendEntry,
      ...mrzAuth,
      signerKeyPath: fixture.lds2SignerKey,
      certRef: 1,
    })
    expect(travelEntry.code, travelEntry.stderr).toBe(0)
    expect(travelEntry.stderr).toContain('Written record signature: valid')

    const travel = await card.lds2Read('travel', { ...mrzAuth, record: 'all' })
    expect(travel.result.code, travel.result.stderr).toBe(0)
    expect(travel.report.recordFiles?.['EF.EntryRecords (0101)']).toHaveLength(1)
    expect(travel.report.recordFiles?.['EF.Certificates (011A)']).toHaveLength(1)
    expect(travel.report.recordFiles?.['EF.EntryRecords (0101)']?.[0]?.verification).toMatchObject({
      valid: true,
      profileValid: true,
      trusted: true,
    })
    expect(travel.report.recordFiles?.['EF.Certificates (011A)']?.[0]?.verification).toMatchObject({
      valid: true,
      profileValid: true,
      trusted: true,
    })

    // A second append reuses the existing certificate record.
    const reuse = await card.lds2Append('travel', {
      specPath: fixture.appendCertificate,
      ...mrzAuth,
    })
    expect(reuse.code, reuse.stderr).toBe(0)
    expect(reuse.stderr).toContain('Reused certificate record #1')

    // PACE-CAN also unlocks an already written LDS2 application.
    const travelCan = await card.lds2Read('travel', {
      can: fixture.can,
      ...common,
      record: 'all',
    })
    expect(travelCan.result.code, travelCan.result.stderr).toBe(0)
    expect(travelCan.result.stderr).toContain('PACE: OK (CAN)')
    expect(travelCan.report.recordFiles?.['EF.EntryRecords (0101)']).toHaveLength(1)

    // A terminal that only holds Travel read may not append a Travel record.
    const denied = await card.lds2Append('travel', {
      specPath: fixture.appendEntry,
      ...mrzAuth,
      chainPath: fixture.restrictedChainPath,
      keyHex: fixture.restrictedKeyHex,
      signerKeyPath: fixture.lds2SignerKey,
      certRef: 1,
    })
    expect(denied.code).not.toBe(0)
    expect(denied.stderr).toMatch(/6982|declined|not authorized/i)

    // --- LDS2 Visa -------------------------------------------------------
    const visaCert = await card.lds2Append('visa', {
      specPath: fixture.appendCertificate,
      ...mrzAuth,
    })
    expect(visaCert.code, visaCert.stderr).toBe(0)
    const visaRecord = await card.lds2Append('visa', {
      specPath: fixture.appendVisa,
      ...mrzAuth,
      signerKeyPath: fixture.lds2SignerKey,
      certRef: 1,
    })
    expect(visaRecord.code, visaRecord.stderr).toBe(0)
    const visa = await card.lds2Read('visa', { ...mrzAuth, record: 'all' })
    expect(visa.result.code, visa.result.stderr).toBe(0)
    expect(visa.report.recordFiles?.['EF.VisaRecords (0103)']).toHaveLength(1)
    expect(visa.report.recordFiles?.['EF.Certificates (011A)']).toHaveLength(1)
    expect(visa.report.recordFiles?.['EF.VisaRecords (0103)']?.[0]?.verification).toMatchObject({
      valid: true,
      signatureValid: true,
    })

    // --- LDS2 Additional Biometrics (transparent EF) ---------------------
    const bioCert = await card.lds2Append('biometrics', {
      specPath: fixture.appendCertificate,
      ...mrzAuth,
    })
    expect(bioCert.code, bioCert.stderr).toBe(0)
    const bioRecord = await card.lds2Append('biometrics', {
      specPath: fixture.appendBiometrics,
      ...mrzAuth,
      signerKeyPath: fixture.lds2SignerKey,
      certRef: 1,
    })
    expect(bioRecord.code, bioRecord.stderr).toBe(0)
    const bio = await card.lds2Read('biometrics', mrzAuth)
    expect(bio.result.code, bio.result.stderr).toBe(0)
    expect(bio.report.recordFiles?.['EF.Biometrics1 (0201)']).toHaveLength(1)
    expect(bioCert.stderr).toContain('certificate record #1')
  } finally {
    await simulator?.stop()
    if (!stopped) await backend.close().catch(() => undefined)
    removeWorkspace(workspace)
  }
}

/**
 * The backend profile used by the card42 runs: LDS2 applications on, PACE/CA/TA
 * advertised, and a full set of optional data groups in the request.
 */
function card42Config(kind: 'ecdsa' | 'rsa'): RawConfig {
  return {
    csca: {
      algorithm: kind === 'rsa' ? 'rsa' : 'ecdsa',
      niaDsc: { algorithm: kind, pss: kind === 'rsa' },
    },
    issuing: {
      lds2: { enabled: true, roles: ['travel', 'visa', 'biometrics'] },
      security: {
        pace: { ecdhGm3des: true, ecdhGmAes128: true },
        aa: { enabled: true, algorithm: 'ecdsa' },
        ca: { enabled: true, keyId: 1 },
        ta: { enabled: true },
      },
    },
  }
}

describe.skipIf(!enabled)('e2e — pkd42 × card42', () => {
  it('personalizes an ECDSA DSC with LDS1, LDS2 and Terminal Authentication', async () => {
    await runScenario(card42Config('ecdsa'))
  }, 300_000)

  it('personalizes an RSA DSC with LDS1, LDS2 and Terminal Authentication', async () => {
    await runScenario(card42Config('rsa'))
  }, 300_000)
})
