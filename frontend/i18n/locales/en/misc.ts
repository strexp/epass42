/**
 * English messages for the audit log, masking, the eMRTD preview and the
 * shared error catalogue.
 */
export default {
  audit: {
    title: 'Audit log',
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
    generic: 'Something went wrong. Please try again.',
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
    document_number_conflict: 'This document number already exists for your organisation.',
    no_active_dsc:
      'No approved Document Signer certificate is available for this organisation yet.',
    no_private_key: 'This certificate has no downloadable private key.',
    private_key_consumed: 'The private key has already been downloaded and deleted.',
    dv_key_unavailable:
      'This Document Verifier key is no longer held here, so terminal certificates cannot be issued.',
    ta_requires_cvca:
      'Terminal Authentication needs an ECDSA CVCA key. Enable the CVCA role or set cvca.algorithm = "ecdsa".',
    dg2_too_large: 'The photo is too large. Choose a smaller image or reduce its quality.',
    passport_not_active: 'This passport is not active.',
  },
} as const
