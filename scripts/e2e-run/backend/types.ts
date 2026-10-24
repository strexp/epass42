/**
 * Response shapes used by the backend e2e suites.
 *
 * They mirror the public JSON of the routes; the suites never import the
 * backend's internal row types, so a wire-format regression is caught.
 */

/** The public metadata of a CSCA-issued signer certificate. */
export interface CertMetadata {
  id: number
  serial: string
  subjectDn: string
  status: string
  source: string
  mnt: string | null
  keyMode: string
  certificateType: 'dsc' | 'lds2'
  lds2Types: string[]
  documentType: string | null
  documentTypes: string[]
  issuancePolicy: string | null
  applicationUrl: string | null
  notBefore: string
  notAfter: string
  privateKeyNotAfter: string | null
  revokedAt: string | null
  fingerprintSha256: string
  hasPrivateKey: boolean
  certPem: string
}

/** The public metadata of a Document Verifier certificate. */
export interface DvMetadata {
  id: number
  holderReference: string
  authorityReference: string
  subjectCn: string | null
  mnt: string | null
  status: string
  source: string
  keyMode: string
  dvClass: string
  permissions: Permissions
  applicationUrl: string | null
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
}

/** The public metadata of a terminal (Inspection System) certificate. */
export interface TerminalMetadata {
  id: number
  dvCertId: number
  holderReference: string
  authorityReference: string
  subjectCn: string | null
  mnt: string | null
  status: string
  source: string
  keyMode: string
  permissions: Permissions
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
}

/** A DV/terminal authorization as returned by the API. */
export interface Permissions {
  epassport: { dg3: boolean; dg4: boolean }
  travel: { read: boolean; write: boolean }
  visa: { read: boolean; write: boolean }
  biometrics: { read: boolean; write: boolean }
}

/** The metadata of a DSC signing request. */
export interface RequestMetadata {
  reference: string
  status: string
  createdAt: string
  expiresAt: string
  requesterAccountId: number | null
  deliveryMode: 'applicant' | 'reviewer'
  consumedAt: string | null
  reviewedAt: string | null
  rejectReason: string | null
  revokedAt: string | null
  revokeReason: string | null
  dscSelection: 'nia' | 'owned'
  mnt: string | null
  ip: string | null
  dataGroups: number[]
  email: string | null
}

/** A page of audit entries. */
export interface AuditPage {
  total: number
  items: {
    id: number
    createdAt: string
    actor: string | null
    actorMnt: string | null
    action: string
    targetType: string | null
    targetId: string | number | null
    ip: string | null
    detail: unknown
  }[]
}
