/**
 * English messages for the public PKD directory.
 */
export default {
  title: 'PKD directory',
  certificates: 'Certificates',
  crls: 'Revocation lists',
  masterlists: 'Master lists',
  dscs: 'Document signers',
  name: 'Name',
  type: 'Type',
  policy: 'Policy',
  validity: 'Validity',
  url: 'URL',
  status: 'Status',
  revoked: 'Revoked documents',
  revokedHint:
    'Revoked passports are published as SHA-256 hashes of their canonical MRZ fields (document type, issuing state, document number and date of birth). Hash the document you hold, or look it up below — no personal data is published.',
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
