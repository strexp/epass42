/**
 * English messages for the public PKD directory.
 */
export default {
  title: 'PKD directory',
  subtitle: 'Published certificates, revocation lists and revoked documents.',
  certificates: 'Signing CA',
  certificatesHint: 'Download a certificate as DER or PEM and verify it with standard PKI tooling.',
  crls: 'Revocation lists',
  masterlists: 'Master lists',
  cvca: 'Verifying CA',
  cvcaHint:
    'Country Verifying CA certificates: the trust anchors for reading and writing protected data.',
  dvs: 'Document verifiers',
  dvsHint: 'Issued Document Verifier certificates with their read and write authorization.',
  holderReference: 'Holder reference',
  permissions: 'Authorization',
  dscs: 'Document signers',
  dscsHint:
    'Active and revoked Document Signer certificates, with policy, type, validity and application URL.',
  name: 'Name',
  type: 'Type',
  policy: 'Policy',
  validity: 'Validity',
  url: 'URL',
  status: 'Status',
  revoked: 'Revoked documents',
  revokedHint:
    'Revoked documents are listed below. To check a document you hold, enter its details and ePass 42 will tell you whether it is revoked.',
  hash: 'Hash',
  documentCode: 'Document type',
  issuingState: 'Issuing state',
  documentNumber: 'Document number',
  dateOfBirth: 'Date of birth',
  revokedAt: 'Revoked at',
  check: 'Check',
  revokedYes: 'Revoked: this document is on the revocation list.',
  revokedNo: 'Not revoked: no matching hash was found.',
  ldif: 'LDIF dump',
  ldifHint: 'Import this into OpenLDAP with slapadd.',
  objectId: 'Object',
  crlNumber: 'CRL number',
} as const
