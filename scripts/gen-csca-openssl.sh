#!/usr/bin/env bash
# gen-csca-openssl.sh - generate a comparison CSCA with the OpenSSL CLI.
#
# The recommended generator is `pnpm --filter @epass42/scripts gen-csca`, which
# emits the PrivateKeyUsagePeriod extension required by ICAO Doc 9303-12
# §7.1.1.  `openssl req` cannot express that extension, so this script exists
# only to produce a certificate for cross-checking the ePass 42 output.
#
# Usage:
#   scripts/gen-csca-openssl.sh rsa   [outdir]
#   scripts/gen-csca-openssl.sh ecdsa [outdir]
set -euo pipefail

MODE="${1:-rsa}"
OUTDIR="${2:-.}"

CN="${CN:-ePass 42 OpenSSL CSCA}"
COUNTRY="${COUNTRY:-XD}"
LOCALITY="${LOCALITY:-XDN}"
VALIDITY_DAYS="${VALIDITY_DAYS:-4745}"   # ~13 years
CRL_DP="${CRL_DP:-ldap://epass42.local/c=XD}"

mkdir -p "$OUTDIR"
CONF="$(mktemp)"
trap 'rm -f "$CONF"' EXIT

# OpenSSL config mirroring the CSCA profile extensions it can express.
cat >"$CONF" <<EOF
[ req ]
distinguished_name = dn
x509_extensions    = v3_ca
prompt             = no

[ dn ]
C  = $COUNTRY
L  = $LOCALITY
CN = $CN

[ v3_ca ]
subjectKeyIdentifier   = hash
authorityKeyIdentifier = keyid:always
keyUsage               = critical, keyCertSign, cRLSign
basicConstraints       = critical, CA:TRUE, pathlen:0
crlDistributionPoints  = URI:$CRL_DP
# San/ian with directoryName are not representable in a plain openssl config;
# see the ePass 42 generator for a fully conforming certificate.
EOF

case "$MODE" in
  rsa)
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 \
      -out "$OUTDIR/csca-openssl.key"
    openssl req -new -x509 -key "$OUTDIR/csca-openssl.key" \
      -config "$CONF" -days "$VALIDITY_DAYS" -sha256 \
      -outform PEM -out "$OUTDIR/csca-openssl.crt"
    ;;
  ecdsa)
    # Explicit EC parameters are required by Doc 9303-12 §4.1.6.3; OpenSSL's
    # default is a named curve, so pass -param_enc explicit.
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
      -out "$OUTDIR/csca-openssl.key"
    openssl req -new -x509 -key "$OUTDIR/csca-openssl.key" \
      -config "$CONF" -days "$VALIDITY_DAYS" -sha256 \
      -param_enc explicit \
      -outform PEM -out "$OUTDIR/csca-openssl.crt"
    ;;
  *)
    echo "error: unknown mode '$MODE' (expected rsa or ecdsa)" >&2
    exit 2
    ;;
esac

openssl x509 -in "$OUTDIR/csca-openssl.crt" -noout -text | sed -n '/X509v3 extensions/,/Signature Algorithm/p'
echo "Wrote $OUTDIR/csca-openssl.key and $OUTDIR/csca-openssl.crt"
