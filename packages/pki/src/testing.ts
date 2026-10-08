/**
 * Test support helpers (not part of the public API).
 *
 * These build throwaway keys and certificates so the unit tests can exercise
 * the CMS/CRL/SOD paths without shipping fixtures.
 */
import { generateRsaKeyPair, type RsaKeyPair } from './crypto/crypto'
import { createCscaRoot, createDsc, type CscaProfile, type DscProfile } from './x509/x509'

export const TEST_CRL_DP = ['ldap://epass42.local/c=XD']

export const TEST_DATES = {
  notBefore: new Date('2026-01-01T00:00:00Z'),
  notAfter: new Date('2039-01-01T00:00:00Z'),
  keyNotAfter: new Date('2031-01-01T00:00:00Z'),
}

export interface TestCa {
  key: RsaKeyPair
  certificate: Awaited<ReturnType<typeof createCscaRoot>>['certificate']
  der: Uint8Array
  pem: string
}

/** Generates a throwaway RSA-2048 PKCS#1 CSCA. */
export async function createTestCa(commonName = 'ePass 42 Test CSCA'): Promise<TestCa> {
  const key = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
  const generated = await createCscaRoot(
    {
      commonName,
      ...TEST_DATES,
      crlDistributionPoints: TEST_CRL_DP,
      pss: false,
    } satisfies CscaProfile,
    key,
  )
  return { key, certificate: generated.certificate, der: generated.der, pem: generated.pem }
}

export type TestDsc = TestCa

/** Generates a throwaway DSC signed by the CA. */
export async function createTestDsc(
  ca: TestCa,
  commonName = 'ePass 42 Test DSC',
): Promise<TestDsc> {
  const key = await generateRsaKeyPair({ modulusLength: 2048, pss: false })
  const generated = await createDsc(
    {
      commonName,
      documentTypes: ['P'],
      ...TEST_DATES,
      crlDistributionPoints: TEST_CRL_DP,
      pss: false,
    } satisfies DscProfile,
    key,
    { certificate: ca.certificate, key: ca.key },
  )
  return { key, certificate: generated.certificate, der: generated.der, pem: generated.pem }
}
