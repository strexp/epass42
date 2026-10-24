/**
 * Certificate and authorization-chain fixtures shared by the two e2e suites.
 *
 * Pure code: imports `@epass42/pki` only, performs no I/O and starts nothing.
 */
import {
  createCscaRoot,
  createCvCertificate,
  createCvcaRoot,
  createDsc,
  createLds2Signer,
  createMasterListSigner,
  cvPublicKeyOf,
  generateEcKeyPair,
  type CertKeyPair,
  type CvKeyPair,
  type EcKeyPair,
  type GeneratedCertificate,
  type GeneratedCvCertificate,
} from '@epass42/pki'
import type { DvPermissions } from '@epass42/shared'

/** CRL distribution points used by every generated certificate. */
export const CRL_DISTRIBUTION_POINTS = ['ldap://epass42.local/c=XD']

/** The test country (alpha-2). */
export const COUNTRY = 'XD'

/** A validity window around "now" that keeps fixtures stable for ten years. */
export function testValidity(now: Date = new Date()): { notBefore: Date; notAfter: Date } {
  return {
    notBefore: new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)),
    notAfter: new Date(Date.UTC(now.getUTCFullYear() + 10, 0, 1)),
  }
}

/** Full LDS1/LDS2 authorizations (the broadest terminal profile). */
export const ALL_PERMISSIONS: DvPermissions = {
  epassport: { dg3: true, dg4: true },
  travel: { read: true, write: true },
  visa: { read: true, write: true },
  biometrics: { read: true, write: true },
}

/** A CSCA plus one Document Signer issued by it. */
export interface SignerChain {
  csca: GeneratedCertificate
  cscaKey: CertKeyPair
  dsc: GeneratedCertificate
  dscKey: EcKeyPair
}

/** Issues a CSCA root and a DSC signed by it. */
export async function issueSignerChain(commonName = 'E2E DSC'): Promise<SignerChain> {
  const { notBefore, notAfter } = testValidity()
  const cscaKey = await generateEcKeyPair('P-256')
  const csca = await createCscaRoot(
    {
      commonName: 'E2E CSCA',
      country: COUNTRY,
      locality: 'XDN',
      notBefore,
      notAfter,
      privateKeyNotAfter: notAfter,
      crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
    },
    cscaKey,
  )
  const dscKey = await generateEcKeyPair('P-256')
  const dsc = await createDsc(
    {
      commonName,
      country: COUNTRY,
      documentTypes: ['P', 'I'],
      notBefore,
      notAfter,
      crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
    },
    { publicKey: dscKey.publicKey },
    { certificate: csca.certificate, key: cscaKey },
  )
  return { csca, cscaKey, dsc, dscKey }
}

/** A CV authorization chain (CVCA -> DV -> terminal). */
export interface CvChain {
  cvca: GeneratedCvCertificate
  cvcaKey: CvKeyPair
  dv: GeneratedCvCertificate
  dvKey: CvKeyPair
  terminal: GeneratedCvCertificate
  terminalKey: CvKeyPair
}

/** Issues a CVCA root, a domestic DV and a terminal certificate. */
export async function issueCvChain(permissions: DvPermissions = ALL_PERMISSIONS): Promise<CvChain> {
  const { notBefore, notAfter } = testValidity()
  const cvcaKey = (await generateEcKeyPair('P-256')) as CvKeyPair
  const dvKey = (await generateEcKeyPair('P-256')) as CvKeyPair
  const terminalKey = (await generateEcKeyPair('P-256')) as CvKeyPair

  const cvca = await createCvcaRoot(
    {
      country: COUNTRY,
      holderMnemonic: 'CVCA',
      sequence: '1',
      role: 'cvca',
      permissions,
      notBefore,
      notAfter,
    },
    cvcaKey,
  )
  const dv = await createCvCertificate(
    {
      country: COUNTRY,
      holderMnemonic: 'DV',
      sequence: '1',
      role: 'dv',
      dvClass: 'domestic',
      permissions,
      notBefore,
      notAfter,
      publicKey: cvPublicKeyOf(dvKey),
    },
    { authorityReference: cvca.holderReference, key: cvcaKey },
  )
  const terminal = await createCvCertificate(
    {
      country: COUNTRY,
      holderMnemonic: 'IS',
      sequence: '1',
      role: 'terminal',
      permissions,
      notBefore,
      notAfter,
      publicKey: cvPublicKeyOf(terminalKey),
    },
    { authorityReference: dv.holderReference, key: dvKey },
  )
  return { cvca, cvcaKey, dv, dvKey, terminal, terminalKey }
}

/** Issues an LDS2 Signer (TS/V/B) certificate from the given CSCA. */
export async function issueLds2Signer(
  csca: GeneratedCertificate,
  cscaKey: CertKeyPair,
): Promise<GeneratedCertificate> {
  const { notBefore, notAfter } = testValidity()
  const key = await generateEcKeyPair('P-256')
  return createLds2Signer(
    {
      commonName: 'LDS2TS',
      country: COUNTRY,
      lds2Types: ['ts', 'v', 'b'],
      notBefore,
      notAfter,
    },
    { publicKey: key.publicKey },
    { certificate: csca.certificate, key: cscaKey },
  )
}

/** Issues a Master List Signer certificate from the given CSCA. */
export async function issueMasterListSigner(
  csca: GeneratedCertificate,
  cscaKey: CertKeyPair,
): Promise<{ certificate: GeneratedCertificate; key: CertKeyPair }> {
  const { notBefore, notAfter } = testValidity()
  const key = await generateEcKeyPair('P-256')
  const certificate = await createMasterListSigner(
    {
      commonName: 'E2E MLS',
      country: COUNTRY,
      notBefore,
      notAfter,
      crlDistributionPoints: CRL_DISTRIBUTION_POINTS,
    },
    key,
    { certificate: csca.certificate, key: cscaKey },
  )
  return { certificate, key }
}
