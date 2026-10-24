/**
 * English messages for the Master List (ML) realm.
 */
export default {
  title: 'Master List',
  subtitle: 'Manage the Master List Signer and publish the CSCA Master List.',
  signerTitle: 'Master List Signer',
  signerHint:
    'The signer certificate is issued by the CSCA and used to sign every published Master List.',
  signerMissing: 'No ML Signer certificate exists yet. Rotate the signer to create one.',
  signerExpired:
    'The ML Signer expired on {date}. Master List generation is paused; rotate the signer.',
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
  masterListTitle: 'Published Master List',
  masterListHint: 'Querying and downloading a Master List remains public in the PKD directory.',
  latestMasterList: 'Latest Master List',
  publishedAt: 'Published',
  signedBy: 'Signed by',
  noMasterList: 'No Master List has been published yet.',
  generate: 'Generate Master List',
  generateWarning:
    'This builds and publishes a new CSCA Master List signed by the current ML Signer. Continue?',
  signedByRetired:
    'The latest Master List was signed by a retired signer. Generate a new Master List to publish the current signer.',
  openPkd: 'Open public directory',
  noAccess: 'Only ML administrators may view this page.',
  signInHint: 'Sign in with an administrator maintainer account to manage the Master List.',
} as const
