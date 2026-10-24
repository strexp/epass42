/**
 * English messages for the audit log, masking, the eMRTD preview and the
 * shared error catalogue.
 */
export default {
  audit: {
    title: 'Audit log',
    empty: 'No audit entries.',
    time: 'Time',
    actor: 'Actor',
    action: 'Action',
    target: 'Target',
    ip: 'IP',
    detail: 'Detail',
  },
  mask: {
    hidden: 'hidden',
  },
  emrtd: {
    document: 'Document',
    name: 'Name',
    nationality: 'Nationality',
    dob: 'Date of birth',
    sex: 'Sex',
    expiry: 'Date of expiry',
  },
  errors: {
    generic: 'Something went wrong on our side. Please try again in a moment.',
    bad_request: 'The request could not be processed. Check the form and try again.',
    unauthorized: 'Please sign in to continue.',
    forbidden: 'You do not have permission to perform this action.',
    not_found: 'The requested record was not found.',
    validation_failed: 'Please correct the highlighted fields.',
    required: 'This field is required.',
    invalid_url: 'Enter a valid URL.',
    no_security_mechanism: 'Select at least one security mechanism.',
    pace_required: 'Enable PACE before Chip Authentication.',
    request_already_consumed: 'This file has already been claimed and can no longer be retrieved.',
    reveal_not_allowed: 'This file is delivered by staff, not claimed by the applicant.',
    document_number_conflict: 'This document number already exists for your organization.',
    dsc_document_type_mismatch:
      'This Document Signer certificate is not authorized to sign this document type.',
    no_active_dsc:
      'No approved Document Signer certificate is available for this organization yet.',
    no_active_dv:
      'No approved Document Verifier certificate is available for this organization yet.',
    no_dv_available: 'No signing organization is available for this terminal yet.',
    no_private_key: 'This certificate has no downloadable private key.',
    private_key_consumed: 'The private key has already been downloaded and deleted.',
    ta_requires_cvca:
      'Terminal Authentication needs an ECDSA CVCA key. Enable the CVCA role or set cvca.algorithm = "ecdsa".',
    dg2_too_large: 'The photo is too large. Choose a smaller image or reduce its quality.',
    passport_not_active: 'This document is not active.',
    application_not_found: 'This application no longer exists.',
    application_already_reviewed: 'This application has already been reviewed.',
    certificate_not_found: 'This certificate no longer exists.',
    mrz_invalid: 'The document number or date of birth is not valid.',
    request_not_found: 'This request no longer exists.',
    request_not_approved: 'This request has not been approved yet.',
    token_invalid: 'This link is not valid.',
    token_expired: 'This link has expired.',
    dv_key_unavailable: 'No Document Verifier key is available for this organization yet.',
    signature_invalid: 'The signature could not be verified.',
    csca_expired:
      'The CSCA certificate has expired. New DSC/LDS2 certificates are paused; roll the CSCA key over first.',
    nia_dsc_expired:
      'The NIA DSC has expired. New document issuance is paused; rotate the NIA DSC.',
    nia_dv_expired:
      'The NIA DV has expired. New IS certificate issuance is paused; rotate the NIA DV.',
    cvca_expired:
      'The CVCA certificate has expired. Rotate the CVCA key before rotating the NIA DV.',
    certificate_not_active: 'This certificate is not active and cannot be revoked.',
  },
} as const
