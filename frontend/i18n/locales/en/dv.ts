/**
 * English messages for the terminal-certificate (DV) realm.
 */
export default {
  applyTitle: 'Apply for a terminal certificate',
  applicationTitle: 'Terminal certificate application',
  applicationsTitle: 'Terminal certificate applications',
  myApplications: 'My applications',
  adminTitle: 'Terminal certificate applications',
  hint: 'A terminal certificate lets an inspection system authenticate for Terminal Authentication. It is signed by a Document Verifier and its authorization cannot exceed that DV’s grant.',
  applyHint:
    'Request a terminal certificate for an inspection system. The signing Document Verifier is selected automatically from your organisation.',
  stepApplication: 'Application',
  stepReview: 'Review and submit',
  reviewSummary: 'Review the application before submitting it for approval.',
  keyMode: 'Key mode',
  keyModeRemote: 'Generated remotely',
  keyModeUpload: 'Upload CSR / public key',
  subjectCn: 'Certificate common name',
  holderMnemonic: 'Holder mnemonic',
  holderMnemonicHint:
    'Up to 9 letters or digits. The issuing Document Verifier assigns the full certificate reference automatically.',
  csr: 'CSR (PEM)',
  publicKey: 'Public key (SPKI PEM)',
  uploadHint: 'Provide a CSR or a public key; either one is enough.',
  permissionsTitle: 'Requested authorization',
  permissionsHint:
    'Choose the LDS2 applications this terminal may read or write. An administrator may adjust these on approval, and they cannot exceed the signing DV’s grant.',
  validityDays: 'Validity (days)',
  applicationUrl: 'Application page URL',
  notes: 'Notes',
  submittedAt: 'Submitted',
  reviewedAt: 'Reviewed',
  viewApplication: 'View application',
  approve: 'Approve and issue',
  approvedPermissions: 'Approved authorization',
  rejectReason: 'Rejection reason',
  reviewHint:
    'Adjust the authorization if needed, then approve or reject. Approving issues the terminal certificate.',
  download: 'Download certificate',
} as const
