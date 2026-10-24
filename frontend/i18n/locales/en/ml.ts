/**
 * English messages for the Master List (ML) realm.
 */
export default {
  title: 'Master list',
  subtitle: 'Manage the Master List Signer and publish the CSCA master list.',
  signerTitle: 'Master List Signer',
  signerHint:
    'The signer certificate is issued by the CSCA and used to sign every published master list.',
  signerMissing: 'No ML Signer certificate exists yet. Rotate the signer to create one.',
  signerExpired:
    'The ML Signer expired on {date}. Master list generation is paused; rotate the signer.',
  signerExpiring: 'The ML Signer expires on {date} ({days} days remaining). Plan a rotation.',
  signerSerial: 'Serial',
  signerSubject: 'Subject',
  signerValidity: 'Validity',
  signerStatus: 'Status',
  signerFingerprint: 'SHA-256',
  signerCreated: 'Created',
  signerKeyAlgorithm: 'Key algorithm',
  rotateSigner: 'Rotate ML Signer',
  rotateWarning:
    'This retires the current ML Signer and issues a new one under the current CSCA. Existing master lists remain verifiable. Continue?',
  cscaExpired:
    'The CSCA certificate has expired. Roll the CSCA key over before rotating the signer.',
  masterListTitle: 'Published master list',
  masterListHint: 'Querying and downloading a master list remains public in the PKD directory.',
  latestMasterList: 'Latest master list',
  publishedAt: 'Published',
  signedBy: 'Signed by',
  noMasterList: 'No master list has been published yet.',
  generate: 'Generate master list',
  generateWarning:
    'This builds and publishes a new CSCA master list signed by the current ML Signer. Continue?',
  signedByRetired:
    'The latest master list was signed by a retired signer. Generate a new master list to publish the current signer.',
  openPkd: 'Open public directory',
  noAccess: 'Only ML administrators may view this page.',
  signInHint: 'Sign in with an administrator maintainer account to manage the master list.',
} as const
