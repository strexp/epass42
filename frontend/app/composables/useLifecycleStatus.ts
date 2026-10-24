/**
 * Lifecycle status shared by the CSCA, DSC and DV realms.  The backend status
 * routes are public; the UI uses them to warn about expired CA/signer
 * certificates and to gate the submission/review buttons.
 */

/** A certificate status as returned by the lifecycle endpoints. */
export interface LifecycleCertificate {
  id: number
  serial?: string
  holderReference?: string
  status?: string
  notAfter: string | null
  expired: boolean
  daysRemaining: number | null
}

export interface CscaStatus {
  csca: LifecycleCertificate | null
  canIssueCertificates: boolean
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

/** CSCA certificate validity and signer-issuance availability. */
export function useCscaStatus() {
  const status = useState<CscaStatus | null>('csca-lifecycle-status', () => null)
  const loading = ref(false)
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const api = useApi()
      status.value = await api<CscaStatus>('/csca/status')
    } catch {
      status.value = null
    } finally {
      loading.value = false
    }
  }
  return { status, loading, refresh }
}

/** NIA DSC validity and document-issuance availability. */
export function useDscStatus() {
  const status = useState<DscStatus | null>('dsc-lifecycle-status', () => null)
  const loading = ref(false)
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const api = useApi()
      status.value = await api<DscStatus>('/dsc/status')
    } catch {
      status.value = null
    } finally {
      loading.value = false
    }
  }
  return { status, loading, refresh }
}

/** NIA DV validity and IS-certificate issuance availability. */
export function useDvStatus() {
  const status = useState<DvStatus | null>('dv-lifecycle-status', () => null)
  const loading = ref(false)
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const api = useApi()
      status.value = await api<DvStatus>('/dv/status')
    } catch {
      status.value = null
    } finally {
      loading.value = false
    }
  }
  return { status, loading, refresh }
}
