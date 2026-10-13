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
  terms: {
    title: 'Terms of use',
    lead: 'These terms apply when you sign in to ePass 42 or use any of its services. By using the service you accept them.',
    sections: {
      scope: {
        title: 'Scope',
        body: 'ePass 42 is operated by the National Immigration Agency on the dn42 network. It issues and publishes certificates, produces personalization files and runs the public PKD directory. Instructions given on a page apply in addition to these terms.',
      },
      account: {
        title: 'Accounts and access',
        body: 'Use only your own dn42 identity and the access granted to you. Keep your credentials safe and do not share a session. You are responsible for everything done with your account in the realm you signed in to. Administrator and reviewer rights are granted per realm and may be withdrawn.',
      },
      acceptable: {
        title: 'Acceptable use',
        body: 'Do not upload data you are not authorized to handle, submit false or misleading information, impersonate another maintainer, probe or overload the service, or use it to issue documents that are unlawful or unauthorized. Respect the configured limits and the instructions of the operators and reviewers.',
      },
      applications: {
        title: 'Applications and issuance',
        body: 'An application must be accurate and made by someone authorized to request it. Approval is at the operator’s discretion; a request may be approved, adjusted or rejected, and a certificate or personalization file may be revoked for misuse. A generated private key and a personalization file are delivered once and must be stored securely; losing them does not entitle you to a new copy.',
      },
      directory: {
        title: 'Certificates and the directory',
        body: 'Certificates, revocation lists, master lists and the hashes of revoked documents are published so that verifying terminals can build the trust chain. Do not misrepresent a published certificate or its authorization, and do not use the directory for any purpose other than verification.',
      },
      intellectual: {
        title: 'Intellectual property',
        body: 'The service, its documentation and the material it publishes remain with the operator or their respective owners. You receive only the rights needed to use the service as these terms allow.',
      },
      availability: {
        title: 'Availability and liability',
        body: 'The service is provided on a best-effort basis, without a guarantee of uninterrupted availability or of a particular result. To the extent the law allows, the operator is not liable for indirect or consequential loss. You remain responsible for verifying the documents and certificates you rely on.',
      },
      enforcement: {
        title: 'Enforcement',
        body: 'Access may be suspended, and certificates revoked, if these terms or the applicable rules are breached, or to protect the service or its users. Serious cases may be reported through the affected maintainer.',
      },
      changes: {
        title: 'Changes',
        body: 'These terms may be updated. Continued use of the service after an update means you accept the new version.',
      },
    },
  },
} as const
