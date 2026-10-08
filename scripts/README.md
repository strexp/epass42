# pkd42 scripts (M2)

Two tools build and check the CSCA/DSC PKI objects:

| Script                | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `src/gen-csca.ts`     | generate a conforming CSCA root certificate          |
| `src/verify.ts`       | validate certificates, CRLs, Master Lists and EF.SOD |
| `gen-csca-openssl.sh` | comparison generator using the OpenSSL CLI           |

Both TypeScript tools live in the `@pkd42/scripts` package and are run with
`tsx`:

```bash
pnpm --filter @pkd42/scripts exec tsx src/gen-csca.ts --help
pnpm --filter @pkd42/scripts exec tsx src/verify.ts --help
```

## Generating a CSCA

```bash
pnpm --filter @pkd42/scripts exec tsx src/gen-csca.ts \
  --out ./csca \
  --cn "Example CSCA" \
  --country XD --locality UDN \
  --validity-years 13 --private-key-usage-years 4 \
  --key-rsa-bits 4096 --hash sha256 \
  --crl-dp ldap://pkd42.local/c=XD \
  --crl-dp https://pkd42.local/crl/csca.crl
```

Outputs:

- `csca.key` — encrypted PKCS#8 private key (AES-256-CBC/PBES2). The passphrase
  is prompted interactively, taken from `PKD42_KEY_PASSPHRASE`, or passed with
  `--passphrase` (for automation only).
- `csca.crt` — certificate, PEM.
- `csca.crt.der` — certificate, DER.
- `csca.json` — serial, SubjectKeyIdentifier, SHA-256 fingerprint and dates.

### Offline generation and key protection

For production-like use, generate the CSCA on an offline machine:

1. Boot an air-gapped host, install Node/pnpm and build the workspace.
2. Run `gen-csca` with a strong passphrase. Prefer typing it at the prompt; do
   not pass it on the command line where it may land in shell history.
3. Move **only** `csca.crt` / `csca.crt.der` / `csca.json` online. Keep
   `csca.key` offline; when the service must sign online, import the key via the
   backend's envelope-encryption path (M13) rather than copying the PEM.
4. Back the key up on encrypted media and record the passphrase in a separate
   secret store.

The pkd42 project intentionally runs with an **online** CSCA (it issues DSC
certificates and CRLs automatically). The offline procedure above is the
conservative option and matches the PKI role description in `PLAN.md`.

## Verifying objects

```bash
# certificate profile (+ optional DSC chain to a CSCA)
pkd42-verify cert ./dsc.crt --kind dsc --ca ./csca.crt

# chain via openssl (Doc 9303-12 §7.1.1)
pkd42-verify chain ./dsc.crt --ca ./csca.crt

# CRL signature and entry count
pkd42-verify crl ./csca.crl.der --ca ./csca.crt

# EF.SOD signature, optional chain and data group hashes
pkd42-verify sod ./ef-sod.der --ca ./csca.crt --dg 1=./dg1.bin

# CSCA Master List signature
pkd42-verify ml ./masterlist.cms
```

Exit code `0` means success; otherwise `error: <message>` is printed and the
process exits non-zero. CI runs `gen-csca` followed by `verify cert` (see
`.github/workflows/ci.yml`), and the `scripts` unit test issues a DSC from the
generated CSCA and verifies the chain end to end.

## OpenSSL comparison script

`gen-csca-openssl.sh` exists only to produce a certificate for cross-checking
the pkd42 output:

```bash
scripts/gen-csca-openssl.sh rsa   ./out
scripts/gen-csca-openssl.sh ecdsa ./out   # uses -param_enc explicit
```

`openssl req` cannot emit the `PrivateKeyUsagePeriod` extension required by
Doc 9303-12 §7.1.1, nor a `directoryName` SubjectAltName, so the OpenSSL
certificate is **not** profile-conforming — use the pkd42 generator for real
artifacts.
