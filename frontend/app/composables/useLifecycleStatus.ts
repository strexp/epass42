/**
 * Lifecycle status shared by the CSCA, CVCA, DSC, DV and ML realms.  The
 * backend status routes are public; the UI uses them to warn about expired CA,
 * signer and key material and to gate the submission/review buttons.
 */

/** A certificate status as returned by the lifecycle endpoints. */
export interface LifecycleCertificate {
  id: number
  serial?: string
  holderReference?: string
  status?: string
  notBefore?: string | null
  notAfter: string | null
  /** Whether the certificate itself has expired. */
  certificateExpired?: boolean
  /** The PrivateKeyUsagePeriod notAfter, when the certificate carries one. */
  privateKeyNotAfter?: string | null
  /** Whether the private key usage period has ended. */
  privateKeyExpired?: boolean
  /** The issuer certificate's notAfter, when known. */
  parentNotAfter?: string | null
  parentExpired?: boolean
  /** The earliest of the certificate, private key and parent expiries. */
  effectiveNotAfter?: string | null
  expired: boolean
  daysRemaining: number | null
}

export interface CscaStatus {
  csca: LifecycleCertificate | null
  canIssueCertificates: boolean
}

export interface CvcaStatus {
  cvca: LifecycleCertificate | null
  defaultDv: LifecycleCertificate | null
  canIssueDvs: boolean
  canIssueTerminals: boolean
  canRotateCvca: boolean
}

export interface DscStatus {
  niaDsc: LifecycleCertificate | null
  canIssueDocuments: boolean
  canRotateNiaDsc: boolean
  csca: LifecycleCertificate | null
}

export interface DvStatus {
  niaDv: LifecycleCertificate | null
  canIssueTerminals: boolean
  canRotateNiaDv: boolean
  cvca: LifecycleCertificate | null
}

/** An ML signer certificate with the metadata shown in the ML inventory. */
export interface MlSignerCertificate extends LifecycleCertificate {
  serial: string
  subjectDn: string
  status: string
  source: string
  keyAlgorithm: string | null
  notBefore: string | null
  createdAt: string
  fingerprintSha256: string
}

export interface MlMasterListStatus {
  id: number
  objectId: string
  publishedAt: string | null
  signerId: number | null
  signerSerial: string | null
  signerStatus: string | null
  signerExpired: boolean | null
  signerNotAfter: string | null
}

export interface MlStatus {
  signer: MlSignerCertificate | null
  latestMasterList: MlMasterListStatus | null
  canGenerateMasterList: boolean
  canRotateSigner: boolean
  csca: LifecycleCertificate | null
}

/** The shared state/refresh shape of every lifecycle status composable. */
function useLifecycleStatus<T>(stateKey: string, path: string) {
  const status = useState<T | null>(stateKey, () => null)
  const loading = ref(false)
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const api = useApi()
      status.value = await api<T>(path)
    } catch {
      status.value = null
    } finally {
      loading.value = false
    }
  }
  return { status, loading, refresh }
}

/** CSCA certificate validity and signer-issuance availability. */
export function useCscaStatus() {
  return useLifecycleStatus<CscaStatus>('csca-lifecycle-status', '/csca/status')
}

/** CVCA certificate / default DV validity and DV-issuance availability. */
export function useCvcaStatus() {
  return useLifecycleStatus<CvcaStatus>('cvca-lifecycle-status', '/cvca/status')
}

/** NIA DSC validity and document-issuance availability. */
export function useDscStatus() {
  return useLifecycleStatus<DscStatus>('dsc-lifecycle-status', '/dsc/status')
}

/** ML Signer validity and master-list generation availability. */
export function useMlStatus() {
  return useLifecycleStatus<MlStatus>('ml-lifecycle-status', '/ml/status')
}

/** NIA DV validity and IS-certificate issuance availability. */
export function useDvStatus() {
  return useLifecycleStatus<DvStatus>('dv-lifecycle-status', '/dv/status')
}

/** The i18n strings needed to describe a certificate/key expiry. */
export interface ExpiryMessages {
  missing: string
  certificate: (date: string) => string
  privateKey: (date: string) => string
  /** Shown when the issuer (CSCA/CVCA) is the reason, not this certificate. */
  parent?: (date: string) => string
}

/**
 * Describes why a signer is unusable: a missing certificate, an expired
 * private-key usage period, or the effective certificate date.  Keeping this in
 * one place prevents the UI from quoting the certificate date when the key
 * period expired first.
 */
export function expiryDescription(
  signer: LifecycleCertificate | null,
  messages: ExpiryMessages,
  formatDate: (value: string | null | undefined) => string,
): string {
  if (!signer) return messages.missing
  if (signer.parentExpired && signer.parentNotAfter && messages.parent) {
    return messages.parent(formatDate(signer.parentNotAfter))
  }
  if (signer.privateKeyExpired && signer.privateKeyNotAfter) {
    return messages.privateKey(formatDate(signer.privateKeyNotAfter))
  }
  return messages.certificate(formatDate(signer.effectiveNotAfter ?? signer.notAfter))
}
