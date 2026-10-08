# pkd42

pkd42 is a dn42 public key infrastructure: a certificate directory (PKD), a
Country Signing Certificate Authority (CSCA) and a Document Signer (DSC) signing
service for eMRTD ("passport") personalization.

## Repository layout

```
pkd42/
├── packages/
│   ├── pki/       pure functions: X.509/CRL/CMS/SOD/MasterList/data groups/perso
│   └── shared/    zod schemas, types, error codes and constants (OIDs, country codes)
├── scripts/       gen-csca, verify (M2)
├── backend/       Fastify + SQLite/Drizzle (M3–M4)
├── frontend/      Nuxt 4 + Naive UI (M11, planned)
├── deploy/        docker-compose, OpenLDAP schema (planned)
└── TODO.md        milestone/task plan
```

## Requirements

- Node.js >= 22 (developed against Node 26)
- pnpm 11

## Quick start

```bash
pnpm install
pnpm check          # format:check + lint + typecheck + test
```

### Run the backend (M3–M4)

```bash
cp backend/.env.example backend/.env      # edit as needed
pnpm --filter @pkd42/backend dev          # or: start
curl http://127.0.0.1:3000/healthz
```

Configuration is read from environment variables overlaid on an optional
`config.toml` (see [`backend/config.example.toml`](backend/config.example.toml)).
Migrations run automatically at startup (`RUN_MIGRATIONS`) and live in
`backend/drizzle`.

### Generate a CSCA (M2)

```bash
pnpm --filter @pkd42/scripts exec tsx src/gen-csca.ts \
  --out ./csca --cn "Example CSCA" --key-rsa-bits 4096 \
  --crl-dp ldap://pkd42.local/c=XD

pnpm --filter @pkd42/scripts exec tsx src/verify.ts \
  cert ./csca/csca.crt --kind csca
```

`csca.key` is written as an encrypted PKCS#8 PEM (passphrase prompted, or set
`PKD42_KEY_PASSPHRASE`). See [`scripts/README.md`](scripts/README.md).

## Design notes

- Country codes used by the project: ICAO three-letter `UDN`
  (MRZ/`localityName`) and alpha-2 `XD` (`C=XD`, PKD paths).
- **CSCA private keys are online** in this design (encrypted at rest; M13),
  which is what lets the service issue DSC certificates and CRLs automatically.
- The PKD role is exposed as REST + LDIF + a read-only LDAP compatibility layer
  (no LDAP writes; uploads go through the application API).
- Data groups are built per ICAO Doc 9303-10 §4.7; the code reused from
  `card42`/`card42-perso-generator` is audited in
  [`packages/pki/AUDIT.md`](packages/pki/AUDIT.md).
- The applicant submits only human-friendly structured fields; images (DG2/DG5/
  DG7) are encoded in the browser, and biometric templates (DG3/DG4) are
  uploaded pre-encoded.

## Status

- **M0** repository scaffolding, ESLint/Prettier, CI, constants — done.
- **M1** `packages/pki` (certificates, CRL, CMS/SOD/CardSecurity, Master List,
  data groups, MRZ, SecurityInfo, perso script, verification) — core done;
  ECDSA remains optional.
- **M2** `scripts/gen-csca` + `scripts/verify` — done.
- **M3** backend skeleton: Fastify + zod/OpenAPI, SQLite/Drizzle schema and
  migrations, configuration, logging, health checks — done.
- **M4** dual-realm OIDC authentication (`/auth/{realm}/login|callback|logout|me`),
  SQLite sessions, dn42 claim mapping and MNT-based admin authorization
  (including delegated AS reviewers) — done.
- **M5** CSCA role: DSC applications, online issuance, revocation and key
  rollover — done.
- **M6** CRL generation with schedule-based refresh — done.
- **M7** DSC signing service: structured requests, DG/AA/CA/SOD/perso build — done.
- **M8** delivery: masked preview, one-time reveal, delivery modes and history — done.

See [`TODO.md`](TODO.md) for the full milestone plan.
