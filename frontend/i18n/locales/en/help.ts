/**
 * English messages for the role-based help page.  Roles follow the business
 * domains that are implemented today; each role has a short name and tagline
 * plus a procedure that spans this site and the surrounding eMRTD tooling
 * (applet installation, personalization, terminal authentication, border
 * verification, ...).
 */
export default {
  title: 'How it works',
  subtitle: 'Select the role that matches you to view the relevant procedure.',
  intro:
    'ePass 42 provides signing certificates, verifying certificates, terminal certificates, document personalization and a public directory. Steps marked “On this site” are completed in this application; the remaining steps are completed with your own tooling.',
  related: 'Go to',
  notSureTitle: 'Not sure which role applies to you?',
  notSureBody:
    'Anyone can browse the public PKD directory and check whether a document is revoked without signing in. To apply for a service, select the role that matches your organization and business domain.',
  tag: {
    system: 'On this site',
    external: 'Off-site',
  },
  roles: {
    applicant: {
      name: 'Document holder',
      tagline:
        'Apply for the personalization file for your passport or identity card and claim it once it is approved.',
    },
    reviewer: {
      name: 'Personalization reviewer',
      tagline:
        'Review personalization requests for your organization or maintainer and deliver the results in accordance with the applicable procedure.',
    },
    dscAdmin: {
      name: 'Personalization administrator',
      tagline:
        'Maintain the issuing parameters, delivery mode and NIA Document Signer certificate for the personalization service.',
    },
    certApplicant: {
      name: 'Signing certificate applicant',
      tagline:
        'Apply for a Document Signer (DSC) or LDS2 Signer certificate so your organization can sign documents or LDS2 data.',
    },
    certAdmin: {
      name: 'Signing CA administrator',
      tagline:
        'Review applications, issue and revoke certificates, publish the CRL and roll over the CSCA key.',
    },
    cvca: {
      name: 'Document Verifier applicant',
      tagline:
        'Apply for a Document Verifier (DV) certificate so your organization can issue terminal certificates and authorize reading or writing document data.',
    },
    cvcaAdmin: {
      name: 'Verifying CA administrator',
      tagline:
        'Review DV applications, adjust authorizations, manage delegation and roll over the CVCA key.',
    },
    terminal: {
      name: 'Terminal certificate applicant',
      tagline:
        'Apply for a terminal certificate so an inspection system can read or write protected data during terminal authentication.',
    },
    dvAdmin: {
      name: 'Terminal certificate administrator',
      tagline:
        'Review terminal certificate applications in this realm and maintain the NIA Document Verifier and its validity.',
    },
    mlAdmin: {
      name: 'Master List administrator',
      tagline: 'Manage the Master List Signer and publish the CSCA Master List.',
    },
    personalization: {
      name: 'Personalization operator',
      tagline:
        'Install the eMRTD applet on a chip, write the personalization data and verify it by reading it back.',
    },
    verifier: {
      name: 'Verification terminal',
      tagline:
        'Verify the document signature chain, data integrity and revocation status at border control and similar points.',
    },
    public: {
      name: 'General public',
      tagline:
        'Browse published certificates and revocation lists, and check whether a document is revoked, without signing in.',
    },
  },
  flows: {
    applicant: {
      summary:
        'You submit your document details and photograph on this site, and claim the personalization file once it is approved. Only one valid document is kept at a time; when a new request is approved, the previous document is revoked automatically.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the personalization realm with your dn42 account.',
        },
        s2: {
          title: 'Enter the document details',
          body: 'Complete the required fields for the document type, including name, document number, date of birth and sex. The issuing state and nationality are filled in from the configuration.',
        },
        s3: {
          title: 'Upload a photograph',
          body: 'Upload a recent identity photograph and crop it to a portrait format in the browser. The photograph is compressed according to the configuration.',
        },
        s4: {
          title: 'Add optional information',
          body: 'Optionally provide a card access number (CAN), a signature or display image, additional details and the people to notify.',
        },
        s5: {
          title: 'Wait for review',
          body: 'A reviewing officer checks the submission and approves or rejects it. A rejection states the reason.',
        },
        s6: {
          title: 'Preview and claim',
          body: 'After approval you may preview the result and then claim the personalization file once. Claiming is final; keep the downloaded file in a safe place.',
        },
      },
    },
    reviewer: {
      summary:
        'You review and deliver personalization requests for your organization. The detail page shows the submitted data without masking; you may approve, reject or adjust the delivery mode.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the personalization realm with your dn42 account.',
        },
        s2: {
          title: 'Open the review queue',
          body: 'The review queue lists the requests you may decide on. A delegated reviewer sees only the requests of its own maintainer.',
        },
        s3: {
          title: 'Check the request',
          body: 'The detail page shows the unmasked document details, photograph, contact information and delivery mode. Check each item.',
        },
        s4: {
          title: 'Approve or reject',
          body: 'Approval releases the request for production; a rejection must state the reason. You may adjust the delivery mode for an individual request.',
        },
        s5: {
          title: 'Deliver',
          body: 'In the “produced by staff” mode, produce the file from the to-be-produced queue and hand it to the applicant. The delivery record is available on the request detail page.',
        },
      },
    },
    dscAdmin: {
      summary:
        'You maintain the operating parameters, delivery mode and NIA Document Signer certificate of the personalization service. You may adjust the issuing profile, security mechanisms and LDS2 applications, and rotate the NIA DSC before it expires.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list and are checked per business domain.',
        },
        s2: {
          title: 'Maintain the issuing profile',
          body: 'On the settings page, maintain the issuing authority, personalization device, DG13 policy, document validity and DG2 size limit.',
        },
        s3: {
          title: 'Configure security options',
          body: 'Enable LDS2 applications as required and set the default options for PACE, Active Authentication, Chip Authentication and Terminal Authentication.',
        },
        s4: {
          title: 'Select the delivery mode',
          body: 'Choose whether applicants claim their files themselves or staff produce and deliver them centrally.',
        },
        s5: {
          title: 'Manage the NIA DSC',
          body: 'The certificate information card at the bottom of the home page shows the NIA DSC certificate and private-key validity. Rotate the NIA DSC before it expires, and roll over the CSCA first if necessary.',
        },
        s6: {
          title: 'Review the audit log',
          body: 'The audit log records submissions, reviews, issuance and rotation for traceability.',
        },
      },
    },
    certApplicant: {
      summary:
        'You submit a signing certificate application on this site; the CSCA administrator reviews it and issues the certificate. For a DSC, the certificate and private-key validity periods are managed separately, and a server-generated private key can be downloaded only once.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the signing certificate realm with your dn42 account.',
        },
        s2: {
          title: 'Complete the application',
          body: 'Choose the certificate type: DSC or LDS2 Signer. For a DSC, provide the common name, document types and validity; you may also provide the organization and organizational unit. For an LDS2 Signer, provide the common name, roles and validity; you may also provide the issuance policy and application URL.',
        },
        s3: {
          title: 'Choose the key mode',
          body: 'Have the service generate the key pair, or upload a CSR / public key (SPKI PEM). In the upload mode the private key remains in your possession.',
        },
        s4: {
          title: 'Wait for review',
          body: 'The CSCA administrator checks the subject, key material and authorization scope, then approves or rejects the application.',
        },
        s5: {
          title: 'Collect the certificate',
          body: 'After approval the certificate is downloadable as PEM/DER. A server-generated private key can be downloaded only once and is deleted immediately after the download. The certificate is published to the public PKD.',
        },
        s6: {
          title: 'Use the certificate',
          body: 'Use the DSC to build the EF.SOD and the personalization file for a document. An LDS2 Signer signs LDS2 data such as travel stamps, electronic visas or additional biometrics.',
        },
      },
    },
    certAdmin: {
      summary:
        'You run the signing certificate authority: review applications, issue and revoke certificates, publish the CRL, maintain delegation and roll over the CSCA key. The Master List is published by the separate Master List administrator.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list and are checked per business domain.',
        },
        s2: {
          title: 'Review applications',
          body: 'Check the subject, key material, document types or LDS2 roles and validity. Approval issues the certificate online.',
        },
        s3: {
          title: 'Manage certificates',
          body: 'The certificate registry shows the certificate and private-key validity. Revoke a certificate when necessary; the CRL is regenerated automatically after revocation.',
        },
        s4: {
          title: 'Publish the CRL',
          body: 'The CRL is available as PEM/DER, refreshed on the configured schedule and updated immediately after a revocation.',
        },
        s5: {
          title: 'Maintain delegation',
          body: 'On the home page, choose whether a maintainer uses the NIA DSC or its own certificate. The switch is available only while the own certificate is valid.',
        },
        s6: {
          title: 'Roll over the CSCA',
          body: 'Roll over from the certificate information card at the bottom of the home page. The service issues a link certificate that connects the new and previous keys. Once the certificate or private key expires, issuance and CRL signing are paused.',
        },
      },
    },
    cvca: {
      summary:
        'You submit a Document Verifier (DV) certificate application on this site; the CVCA administrator reviews it and issues the certificate. The certificate validity does not exceed 92 days, and a server-generated private key can be downloaded only once.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the verifying certificate realm with your dn42 account.',
        },
        s2: {
          title: 'Complete the application',
          body: 'Provide the common name and holder mnemonic, choose the DV class (domestic or foreign), the authorization scope and the validity, and optionally provide the application URL and notes.',
        },
        s3: {
          title: 'Choose the key mode',
          body: 'Have the CVCA generate the key pair, or upload a CSR / public key (SPKI PEM).',
        },
        s4: {
          title: 'Wait for review',
          body: 'The CVCA administrator checks the subject and authorization scope, and may adjust the DV class or permissions before approval.',
        },
        s5: {
          title: 'Collect the certificate',
          body: 'After approval the certificate is downloadable as DER. A server-generated private key can be downloaded only once. The certificate is published to the PKD, and the DV can use it to issue terminal certificates.',
        },
      },
    },
    cvcaAdmin: {
      summary:
        'You run the verifying certificate authority: review DV applications, adjust authorizations, maintain DV delegation and roll over the CVCA key. Issuance is paused once the CVCA or the default DV expires.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list and are checked per business domain.',
        },
        s2: {
          title: 'Review DV applications',
          body: 'Check the subject, DV class and requested permissions, adjust them if necessary, then approve or reject the application.',
        },
        s3: {
          title: 'Maintain DV delegation',
          body: 'On the home page, choose for each maintainer whether it uses the CVCA default DV or its own DV. Delegation must be renewed after the own DV expires.',
        },
        s4: {
          title: 'Check certificate status',
          body: 'The certificate information card at the bottom of the home page shows the CVCA and default DV validity. DV and terminal certificate issuance is paused once the CVCA expires.',
        },
        s5: {
          title: 'Roll over the CVCA',
          body: 'Roll over from the certificate information card. The service issues a link certificate that connects the new and previous keys.',
        },
        s6: {
          title: 'Publish',
          body: 'The CVCA and DV certificates are published to the PKD so terminals can build the authorization trust chain.',
        },
      },
    },
    terminal: {
      summary:
        'You submit a terminal certificate application on this site; the terminal certificate administrator reviews it and issues the certificate. The certificate validity does not exceed 92 days and never exceeds the validity of the signing DV.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the terminal certificate realm with your dn42 account.',
        },
        s2: {
          title: 'Complete the application',
          body: 'Provide the common name and holder mnemonic, choose the requested permissions and validity, and optionally provide notes.',
        },
        s3: {
          title: 'Choose the key mode',
          body: 'Have the service generate the key pair, or upload a CSR / public key (SPKI PEM).',
        },
        s4: {
          title: 'Wait for review',
          body: 'An administrator checks the application and clamps the permissions to the signing DV’s authorization before approval.',
        },
        s5: {
          title: 'Collect the certificate',
          body: 'After approval the certificate is downloadable as DER. A server-generated private key can be downloaded only once. The certificate validity is capped by the remaining validity of the signing DV and the CVCA.',
        },
        s6: {
          title: 'Install and use',
          body: 'Install the certificate and private key in the inspection system so it can read or write document data within the authorized scope.',
        },
      },
    },
    dvAdmin: {
      summary:
        'You review terminal certificate applications in this realm and maintain the NIA Document Verifier. You may adjust the requested permissions, approve or reject applications, and rotate the NIA DV while the CVCA is valid.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list and are checked per business domain.',
        },
        s2: {
          title: 'Review terminal applications',
          body: 'Check the subject, permissions and validity. Before approval, the permissions may be adjusted within the signing DV’s authorization.',
        },
        s3: {
          title: 'Check certificate status',
          body: 'The certificate information card at the bottom of the home page shows the NIA DV and CVCA validity. Terminal certificate issuance is paused if either has expired.',
        },
        s4: {
          title: 'Rotate the NIA DV',
          body: 'Rotate the NIA DV from the certificate information card. The previous certificate is retired. CV certificates cannot be revoked, so certificates already issued remain valid until they expire.',
        },
        s5: {
          title: 'Review the audit log',
          body: 'The audit log records the submission, approval and rejection of terminal applications.',
        },
      },
    },
    mlAdmin: {
      summary:
        'You are responsible for the CSCA Master List Signer and publication. The Master List is signed by the current Master List Signer; generation and rotation are paused when the signer or the CSCA expires.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Only the configured Master List administrators may access the Master List realm.',
        },
        s2: {
          title: 'Check the signer',
          body: 'The signer card shows the serial number, subject, status, certificate validity, key algorithm and fingerprint.',
        },
        s3: {
          title: 'Rotate the signer',
          body: 'Rotate the signer while the CSCA is valid. The previous signer is retired, and master lists already published remain verifiable.',
        },
        s4: {
          title: 'Generate and publish the Master List',
          body: 'Generate the Master List and publish it to the PKD. The latest Master List shows its object identifier, publication time and signer.',
        },
        s5: {
          title: 'Check the publication status',
          body: 'If the latest Master List was signed by a retired signer, generate it again. An expired signer cannot generate a Master List.',
        },
      },
    },
    personalization: {
      summary:
        'A personalization file becomes a working document only after the eMRTD applet has been installed on the chip and the data groups and security objects have been written. You are responsible for card production and verification.',
      steps: {
        s1: {
          title: 'Obtain the applet',
          body: 'Build the card42 eMRTD applet together with its shared Java Card library so the CAPs are available for loading.',
        },
        s2: {
          title: 'Install the applet',
          body: 'Load the CAP with GlobalPlatformPro and create the LDS1 instance with the CardReset privilege so that it is default-selected and its master file is readable.',
        },
        s3: {
          title: 'Claim the personalization file',
          body: 'Claim the personalization file from ePass 42 once. The file contains the submitted data groups, EF.CardAccess, EF.CardSecurity and EF.SOD.',
        },
        s4: {
          title: 'Write the card',
          body: 'Send the DGI sequence with STORE DATA and write the BAC/PACE seeds, authentication keys, CAN, LDS1 data groups and LDS2 applications in order.',
        },
        s5: {
          title: 'Read back and verify',
          body: 'Read the card with the host CLI and perform Passive, Active, Chip and Terminal Authentication against the published PKD data.',
        },
        s6: {
          title: 'Hand over the document',
          body: 'Only after verification succeeds should the physical document be handed to its holder.',
        },
      },
    },
    verifier: {
      summary:
        'A verification terminal trusts a chip only after the signature chain, data-group hashes and revocation status have all been verified against the published PKD data. Terminal Authentication is also required to read protected data.',
      steps: {
        s1: {
          title: 'Fetch the trusted data',
          body: 'Download the CSCA, CVCA, DV, DSC, CRL and Master List from the PKD, or import the LDIF dump into a local LDAP server.',
        },
        s2: {
          title: 'Build the signature trust chain',
          body: 'Verify the Master List signature and validate the DSC up to a trusted CSCA, confirming that it has not been revoked.',
        },
        s3: {
          title: 'Build the authorization trust chain',
          body: 'Validate the DV up to the CVCA and check the terminal certificate’s authorization scope. Terminal Authentication is used to read protected data.',
        },
        s4: {
          title: 'Read the chip',
          body: 'Open the session with BAC (MRZ) or PACE (MRZ or CAN), read DG1, DG2 and EF.SOD, and read EF.CardAccess, EF.CardSecurity and LDS2 applications as required.',
        },
        s5: {
          title: 'Passive, Active and Chip Authentication',
          body: 'Verify the EF.SOD CMS signature and the data-group hashes; perform Active Authentication and Chip Authentication as required.',
        },
        s6: {
          title: 'Check revocation',
          body: 'Hash the canonical MRZ fields (document type, issuing state, document number and date of birth) and compare the result with the revoked-document hashes published in the PKD.',
        },
      },
    },
    public: {
      summary:
        'The public directory is available without signing in. You may download certificates, CRLs and master lists, or import the LDIF dump, and check whether a document has been revoked.',
      steps: {
        s1: {
          title: 'Browse the directory',
          body: 'The PKD directory lists the signing CAs, verifying CAs, DVs, DSCs, Master List Signers, CRLs and master lists.',
        },
        s2: {
          title: 'Download and verify',
          body: 'Download any object as DER or PEM and verify it with standard PKI tooling.',
        },
        s3: {
          title: 'Import into LDAP',
          body: 'Download the LDIF dump and import it into your own LDAP directory.',
        },
        s4: {
          title: 'Check revocation',
          body: 'Enter the document type, issuing state, document number and date of birth to check whether the document has been revoked.',
        },
      },
    },
  },
  links: {
    applicant: {
      apply: 'Request a personalization file',
      mine: 'My requests',
    },
    reviewer: {
      queue: 'Review queue',
    },
    dscAdmin: {
      settings: 'Personalization settings',
      audit: 'Audit log',
      home: 'Personalization home',
    },
    certApplicant: {
      apply: 'Apply for a certificate',
      mine: 'My applications',
    },
    certAdmin: {
      certificates: 'Certificate Registry',
      audit: 'Audit log',
    },
    cvca: {
      apply: 'Apply for a DV certificate',
      certificates: 'DV certificates',
    },
    cvcaAdmin: {
      applications: 'CVCA administration',
      certificates: 'DV certificates',
      audit: 'Audit log',
    },
    terminal: {
      apply: 'Apply for a terminal certificate',
      mine: 'My applications',
    },
    dvAdmin: {
      home: 'Terminal certificate home',
      audit: 'Audit log',
    },
    mlAdmin: {
      home: 'Master List',
      audit: 'Audit log',
      directory: 'PKD directory',
    },
    personalization: {
      directory: 'PKD directory',
    },
    verifier: {
      directory: 'PKD directory',
    },
    public: {
      directory: 'PKD directory',
    },
  },
} as const
