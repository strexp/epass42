/**
 * English messages for the role-based help page.  Each role has a short name and
 * tagline plus an end-to-end workflow that spans this site and the surrounding
 * eMRTD tooling (applet installation, personalization, self-hosted signing,
 * border verification, ...).
 */
export default {
  title: 'How it works',
  subtitle: 'Choose the role that matches you to see the relevant end-to-end workflow.',
  intro:
    'ePass 42 covers the whole document lifecycle: signing certificate, personalization and border verification. Steps marked “On this site” happen in this application; the others happen with your own tooling.',
  related: 'Go to',
  notSureTitle: 'Not sure which role fits you?',
  notSureBody:
    'Anyone can browse the public PKD directory and check whether a document is revoked, without signing in.',
  tag: {
    system: 'On this site',
    external: 'Off-site',
  },
  roles: {
    applicant: {
      name: 'Document holder',
      tagline: 'Apply for your document personalization file and claim it once it is approved.',
    },
    reviewer: {
      name: 'Reviewing officer',
      tagline: 'Review and decide on personalization requests for your organization.',
    },
    certApplicant: {
      name: 'Document signer',
      tagline: 'Apply for a Document Signer certificate so your organization can sign documents.',
    },
    certAdmin: {
      name: 'Certificate authority admin',
      tagline: 'Approve applications, issue and revoke certificates and publish the CRL.',
    },
    cvca: {
      name: 'Document Verifier',
      tagline: 'Apply for a Document Verifier certificate on behalf of your organization.',
    },
    terminal: {
      name: 'Inspection system',
      tagline:
        'Apply for a terminal certificate so your inspection system can read or write protected data.',
    },
    cvcaAdmin: {
      name: 'LDS2 certificate administrator',
      tagline:
        'Review Document Verifier and terminal applications, manage delegation and publish the certificates.',
    },
    selfHosted: {
      name: 'Self-hosted service',
      tagline: 'Sign documents with your maintainer’s own certificate in a DSC-only deployment.',
    },
    personalization: {
      name: 'Personalization operator',
      tagline: 'Install the eMRTD applet on a card and write the personalization data.',
    },
    verifier: {
      name: 'Verification terminal',
      tagline: 'Verify documents at the border using the data published in the PKD.',
    },
    public: {
      name: 'General public',
      tagline: 'Browse published material and check whether a document is revoked.',
    },
  },
  flows: {
    applicant: {
      summary:
        'You request the personalization file that will be used to produce your document. An officer approves it, and then you claim it once.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the personalization realm with your dn42 account.',
        },
        s2: {
          title: 'Enter the document details',
          body: 'Fill in your details: name, document number, date of birth and sex.',
        },
        s3: {
          title: 'Add your photo',
          body: 'Crop a recent photo to a 4:5 portrait.',
        },
        s4: {
          title: 'Add anything optional',
          body: 'Optionally add a card access number, a signature or display image, additional details and the people to notify.',
        },
        s5: {
          title: 'Wait for review',
          body: 'A reviewing officer checks your submission and approves or rejects it.',
        },
        s6: {
          title: 'Claim the file once',
          body: 'You can preview the result first. Claiming is final and can be done only once, so save the downloaded file somewhere safe.',
        },
      },
    },
    reviewer: {
      summary:
        'You decide on personalization requests for your organization. The detail page shows the submitted data without masking.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the personalization realm.',
        },
        s2: {
          title: 'Open the review queue',
          body: 'The review queue lists the requests you may decide on.',
        },
        s3: {
          title: 'Open a request',
          body: 'The detail page shows the submitted data without masking, together with the applicant and delivery information.',
        },
        s4: {
          title: 'Approve or reject',
          body: 'Approve to release it for production, or reject with a reason. You may override the delivery mode for this single request.',
        },
        s5: {
          title: 'Deliver',
          body: 'In the “produced by staff” delivery mode, produce the file from the to-be-produced queue and hand it over to the applicant.',
        },
      },
    },
    certApplicant: {
      summary:
        'A Document Signer certificate is what your organization uses to sign document data. You apply for it here, and it is published to the PKD once approved.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the certificate realm with your dn42 account.',
        },
        s2: {
          title: 'Fill in the application',
          body: 'Provide the common name, the organization (O) and optional unit (OU), the document types, the validity and issuance policy, and the URL of your application page.',
        },
        s3: {
          title: 'Choose the key mode',
          body: 'Have the NIA generate the key pair for you, or upload a CSR / public key (SPKI PEM). The private key never leaves your side in the upload mode.',
        },
        s4: {
          title: 'Collect the result',
          body: 'Once approved the certificate is downloadable as PEM/DER. A key generated by the NIA can be downloaded only once and is deleted right after that download.',
        },
        s5: {
          title: 'Sign documents',
          body: 'Use the certificate with your signing service (or your own DSC-only deployment) to build the EF.SOD and the personalization file for each document.',
        },
        s6: {
          title: 'Publish',
          body: 'The certificate, its revocation lists and the master list appear in the public PKD directory so that verifying terminals can build the trust chain.',
        },
      },
    },
    certAdmin: {
      summary:
        'You run the certificate authority: review applications, issue and revoke certificates, refresh the CRL, roll over the CSCA key and publish the master list.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list or from the identity’s MNT, and are checked per realm.',
        },
        s2: {
          title: 'Review applications',
          body: 'Open an application, check the subject and the key material, then approve it to issue the certificate online, or reject it with a reason.',
        },
        s3: {
          title: 'Manage certificates',
          body: 'Revoke a certificate from the registry at any time; revoking it regenerates the CRL automatically.',
        },
        s4: {
          title: 'Publish the CRL',
          body: 'The CRL is available as PEM/DER and is refreshed on the configured schedule and whenever a certificate is revoked.',
        },
        s5: {
          title: 'Roll over the CSCA key',
          body: 'As an administrator, roll over the CSCA key; a link certificate chains the new key to the previous one so trust is not interrupted.',
        },
        s6: {
          title: 'Publish the master list',
          body: 'As an administrator, generate the CSCA master list; it is published to the PKD.',
        },
      },
    },
    cvca: {
      summary:
        'A Document Verifier certificate lets your organization read or write protected data on electronic documents. You apply for it here and it is issued once an administrator approves.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the verification realm with your dn42 account.',
        },
        s2: {
          title: 'Apply for a certificate',
          body: 'Give the certificate a name, choose how the key is created and pick the data your organization needs to read or write.',
        },
        s3: {
          title: 'Review',
          body: 'An administrator checks the request and may adjust it before approving.',
        },
        s4: {
          title: 'Collect the certificate',
          body: 'Approval issues the certificate. If the key was generated for you, download it once and keep it safe.',
        },
        s5: {
          title: 'Publish',
          body: 'The certificate is published in the PKD so terminals can check what it is allowed to do.',
        },
      },
    },
    terminal: {
      summary:
        'A terminal certificate lets an inspection system read or write protected data on electronic documents. You request it for your organization; it is issued once an administrator approves.',
      steps: {
        s1: {
          title: 'Sign in',
          body: 'Sign in to the terminal realm with your dn42 account.',
        },
        s2: {
          title: 'Apply for a certificate',
          body: 'Name the certificate, choose how the key is created and pick the data the system needs to read or write.',
        },
        s3: {
          title: 'Review',
          body: 'An administrator checks the request and may adjust it before approving.',
        },
        s4: {
          title: 'Claim the result',
          body: 'Approval issues the certificate. Download it, and if the key was generated for you, download that once and keep it safe.',
        },
        s5: {
          title: 'Install it',
          body: 'Install the certificate and key in the inspection system; it can then read or write the data your organization is allowed to.',
        },
      },
    },
    cvcaAdmin: {
      summary:
        'You run the LDS2 authorization PKI: the CVCA issues card-verifiable DV certificates, and a DV issues terminal certificates. You review applications and keep the authorization chain published.',
      steps: {
        s1: {
          title: 'Sign in as an administrator',
          body: 'Administrator rights come from the configured maintainer list or from the identity’s MNT, and are checked per realm.',
        },
        s2: {
          title: 'Review DV applications',
          body: 'Open a DV application, check the subject and the requested authorization, adjust the DV class or permissions if needed, then approve or reject.',
        },
        s3: {
          title: 'Review terminal applications',
          body: 'Terminal applications are reviewed by the terminal realm’s administrators; the issued authorization is clamped to the granting DV’s own grant.',
        },
        s4: {
          title: 'DV delegation',
          body: 'Each maintainer chooses whether its terminals are signed by the CVCA default DV or by its own approved DV.',
        },
        s5: {
          title: 'Roll over the CVCA key',
          body: 'As an administrator, roll over the CVCA key; a link certificate chains the new key to the previous one so trust is not interrupted.',
        },
        s6: {
          title: 'Publish',
          body: 'The CVCA and DV certificates appear in the PKD so terminals can build the authorization trust chain.',
        },
      },
    },
    selfHosted: {
      summary:
        'A maintainer may run its own personalization service using its own Document Signer certificate, while the NIA service remains authoritative for the PKD and CSCA.',
      steps: {
        s1: {
          title: 'Obtain a Document Signer certificate',
          body: 'Apply for a certificate here, or issue one from your own CSCA. Keep the private key that the service will sign with.',
        },
        s2: {
          title: 'Deploy a DSC-only instance',
          body: 'Enable only the personalization role so the instance registers the signing routes without running the certificate or directory roles.',
        },
        s3: {
          title: 'Configure your instance',
          body: 'Enable only the personalization role, then set your own login provider and issuing fields in config.toml. The NIA service remains authoritative for the PKD and CSCA.',
        },
        s4: {
          title: 'Declare your own certificate',
          body: 'On the NIA service, mark your maintainer as using its own certificate. Applicants from your network are then directed to your service, though they may still choose the NIA certificate.',
        },
        s5: {
          title: 'Sign and publish',
          body: 'Sign personalization requests, deliver them, and publish your certificate and revocation lists to the public PKD so verifying terminals can build the trust chain.',
        },
      },
    },
    personalization: {
      summary:
        'A personalization file becomes a working document only after the eMRTD applet is installed on a chip and the data groups and security objects are written to it.',
      steps: {
        s1: {
          title: 'Get the applet',
          body: 'Build the card42 eMRTD applet together with its shared Java Card library so the CAPs are available for loading.',
        },
        s2: {
          title: 'Install the applet',
          body: 'Load the CAPs with GlobalPlatformPro and create the LDS1 instance with the CardReset privilege, so it is default-selected and its master file (EF.CardAccess/CardSecurity) is reachable.',
        },
        s3: {
          title: 'Claim the personalization file',
          body: 'Claim the personalization file from ePass 42. It carries the data groups you submitted, plus EF.CardAccess, EF.CardSecurity and EF.SOD, and can be claimed only once.',
        },
        s4: {
          title: 'Personalize the card',
          body: 'Send the DGI sequence with STORE DATA; the applet applies it incrementally: the BAC seed, the Active and Chip Authentication keys, the PACE seed, the CAN and every file.',
        },
        s5: {
          title: 'Read it back and verify',
          body: 'Read the card with the host CLI and run Passive, Active and Chip Authentication against the PKD data before the document is issued.',
        },
        s6: {
          title: 'Hand over the document',
          body: 'Only after verification succeeds should the physical document be handed to its holder.',
        },
      },
    },
    verifier: {
      summary:
        'A verification terminal trusts a chip only if the signature chain, the data-group hashes and the revocation status all check out against the published PKD data.',
      steps: {
        s1: {
          title: 'Fetch the trusted data',
          body: 'Download the CSCA certificates, CRLs and master lists from the PKD as DER/PEM, or import the LDIF dump into an LDAP server.',
        },
        s2: {
          title: 'Build the trust chain',
          body: 'Verify the master list signature, then validate the Document Signer certificate up to a trusted CSCA and check that it has not been revoked.',
        },
        s3: {
          title: 'Read the chip',
          body: 'Open the session with Basic Access Control (MRZ) or PACE (MRZ or CAN), then read DG1, DG2 and EF.SOD, plus EF.CardAccess / EF.CardSecurity when present.',
        },
        s4: {
          title: 'Passive Authentication',
          body: 'Verify the EF.SOD CMS signature with the DSC, chain it to the CSCA, and compare each data group you read with the hash stored in the Security Object.',
        },
        s5: {
          title: 'Active and Chip Authentication',
          body: 'Optionally challenge DG15 for Active Authentication and run Chip Authentication with EF.CardSecurity to confirm that the real chip, not a copy, is answering.',
        },
        s6: {
          title: 'Check revocation',
          body: 'Hash the canonical MRZ fields (document type, issuing state, document number and date of birth) and compare the result with the published revoked-document hashes.',
        },
      },
    },
    public: {
      summary:
        'No sign-in is needed: browse everything that has been published and check whether a document has been revoked.',
      steps: {
        s1: {
          title: 'Browse the directory',
          body: 'The PKD directory lists the published signing and verifying certificates, their revocation lists and the master lists.',
        },
        s2: {
          title: 'Download and verify',
          body: 'Download any object as DER or PEM and verify it with standard PKI tooling.',
        },
        s3: {
          title: 'Import into LDAP',
          body: 'Download the LDIF dump if you want to load the directory into your own LDAP server.',
        },
        s4: {
          title: 'Check a document',
          body: 'Enter the document type, issuing state, document number and date of birth to check whether a document has been revoked.',
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
    certApplicant: {
      apply: 'Apply for a certificate',
      mine: 'My applications',
    },
    certAdmin: {
      certificates: 'Certificate registry',
      audit: 'Audit log',
    },
    cvca: {
      apply: 'Apply for a DV certificate',
      certificates: 'DV certificates',
    },
    terminal: {
      apply: 'Apply for a terminal certificate',
      mine: 'My applications',
    },
    cvcaAdmin: {
      applications: 'CVCA administration',
      terminal: 'Terminal applications',
    },
    selfHosted: {
      certApply: 'Apply for a DSC',
      settings: 'Signing settings',
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
