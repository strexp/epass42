/**
 * English messages for the legal pages: the privacy notice and the retention
 * and deletion policy.  They describe what the software actually does, so keep
 * them in step with the backend behavior and with the `zh` copy.
 */
export default {
  updated: 'Last updated: 13 October 2026',
  privacy: {
    title: 'Privacy notice',
    lead: 'This page explains how ePass 42, operated by the National Immigration Agency, processes personal data when you use the service.',
    sections: {
      controller: {
        title: 'Controller',
        body: 'ePass 42 is operated by the National Immigration Agency on the dn42 network. The agency decides why and how the data below is processed. For any question or request, contact the service operator through the maintainer (MNT) responsible for your access.',
      },
      data: {
        title: 'What we process',
        body: 'Sign-in and account: your dn42 account, the MNT and claims returned by your sign-in provider, your IP address, and session records.\nCertificate applications: the common name, organization and unit, holder mnemonic, CSR or public key, requested authorizations, validity, application page URL and notes.\nDocument personalization: document type and number, surname and given names, date of birth, sex, place of birth, address, telephone and email, the card access number, the portrait (DG2/DG5), the signature image (DG7), fingerprints (DG3), iris (DG4), additional personal and document details (DG11-DG13) and people to notify (DG16).\nAudit records: who did what, to which object, from which IP address and when.',
      },
      purpose: {
        title: 'Why we process it',
        body: 'To issue and publish certificates, review applications, produce and deliver the personalization file, check revocation, and keep the service secure and accountable. Processing is limited to what these tasks require.',
      },
      sharing: {
        title: 'Publication and sharing',
        body: 'Certificates, revocation lists, master lists and the hashes of revoked documents are published in the public PKD directory, because verifying terminals must be able to build the trust chain. Personalization data and private keys are never published; access is limited to the applicant, the reviewers and the administrators of the relevant realm.',
      },
      security: {
        title: 'How we protect it',
        body: 'Generated personalization files and private keys are envelope-encrypted at rest and can be claimed only once; data is masked in listings and previews. Sign-in sessions are stored as hashes and expire. Access follows the realm roles and is recorded in the audit log.',
      },
      retention: {
        title: 'How long we keep it',
        body: 'The periods and the deletion behavior are described under “Retention and deletion”. In short: a personalization file is deleted as soon as it is claimed, and a generated private key as soon as it is downloaded.',
      },
      rights: {
        title: 'Your rights',
        body: 'You may ask to access, correct or delete the data held about you, and may withdraw a consent. Ask the service operator through your maintainer (MNT); we answer within a reasonable period. For the integrity of the PKI, published certificates and revocation records may have to be kept even after a deletion request.',
      },
      changes: {
        title: 'Changes',
        body: 'This notice may be updated. The latest version always applies to this service.',
      },
    },
  },
  retention: {
    title: 'Retention and deletion',
    lead: 'ePass 42 keeps personal data only as long as the task or the law requires. This page describes what happens to each kind of data.',
    sections: {
      principle: {
        title: 'Principle',
        body: 'Data is kept while the related request or certificate is active, and for the period the operator configures for security and accountability, then deleted.',
      },
      personalization: {
        title: 'Personalization file',
        body: 'The produced personalization file is stored encrypted and deleted from the server immediately after it is claimed (applicant delivery) or handed over (staff delivery). A claimed file cannot be retrieved again; only the claim metadata remains.',
      },
      keys: {
        title: 'Private keys',
        body: 'A private key generated for you is stored encrypted and deleted after its single download. It cannot be downloaded a second time and is never published.',
      },
      requests: {
        title: 'Personalization requests',
        body: 'A request keeps the data you submitted, envelope-encrypted, while it is active (submitted, approved and, for staff delivery, until produced). Expired requests and their encrypted payloads are deleted by the operator; the reference and the audit metadata may be kept.',
      },
      pki: {
        title: 'Certificates and the directory',
        body: 'Document Signer and Document Verifier certificates, their revocation lists, the master lists and the hashes of revoked documents are kept for the validity of the certificate and published for verification. Revocation records are kept so a revoked object stays recognizable.',
      },
      audit: {
        title: 'Audit log',
        body: 'Administrative and delivery actions are recorded with actor, action, target, IP address and time, and kept for the period the operator configures, for security and accountability.',
      },
      account: {
        title: 'Account and session',
        body: 'Your session and sign-in state are kept until you sign out or the session expires (seven days by default). The account record links an external sign-in identity to a realm; it is removed when the operator deletes it.',
      },
      deletion: {
        title: 'Requesting deletion',
        body: 'Ask the service operator through your maintainer (MNT) to delete the data held about you. We delete what we can; published certificates and revocation records may be kept for the integrity of the PKI.',
      },
    },
  },
} as const
