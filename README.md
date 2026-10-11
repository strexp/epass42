# ePass 42

ePass 42 is a dn42 public key infrastructure: a certificate directory (PKD), a
Country Signing Certificate Authority (CSCA) and a Document Signer (DSC) signing
service for eMRTD ("passport") personalization.

## Repository layout

```
epass42/
├── packages/
│   ├── pki/       pure functions: X.509/CRL/CMS/SOD/MasterList/data groups/perso
│   └── shared/    zod schemas, types, error codes and constants (OIDs, country codes)
├── scripts/       gen-csca, verify (M2)
├── backend/       Fastify + SQLite/Drizzle (M3–M4)
├── frontend/      Nuxt 4 + Naive UI (M11)
├── deploy/        docker-compose, Dockerfiles and the OpenLDAP schema (LDIF validation)
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
cp backend/config.example.toml backend/config.toml   # edit as needed
pnpm --filter @epass42/backend dev          # or: start
curl http://127.0.0.1:3000/healthz
```

Configuration is read from a single TOML file (`backend/config.toml`, i.e.
`./config.toml` relative to the backend's working directory; see
[`backend/config.example.toml`](backend/config.example.toml)). Migrations run
automatically at startup (`runMigrations`) and live in `backend/drizzle`.

### Run the frontend (M11)

```bash
pnpm --filter @epass42/frontend dev      # http://localhost:3001 (proxies to the API)
pnpm --filter @epass42/frontend build
```

The SPA renders client-side and calls the backend cross-origin
(`NUXT_PUBLIC_API_BASE`, default `http://localhost:3000` in development). The
backend allows the frontend origin via `frontendUrl` and redirects the OAuth
callback back to it. To run everything at once:

```bash
pnpm dev    # backend on :3000, frontend on :3001
```

### Generate a CSCA (M2)

```bash
pnpm --filter @epass42/scripts exec tsx src/gen-csca.ts \
  --out ./csca --cn "Example CSCA" --key-rsa-bits 4096 \
  --crl-dp ldap://epass42.local/c=XD

pnpm --filter @epass42/scripts exec tsx src/verify.ts \
  cert ./csca/csca.crt --kind csca
```

`csca.key` is written as an encrypted PKCS#8 PEM (passphrase prompted, or set
`EPASS42_KEY_PASSPHRASE`). See [`scripts/README.md`](scripts/README.md).

## Design notes

- Country codes used by the project: ICAO three-letter `UDN`
  (MRZ/`localityName`) and alpha-2 `XD` (`C=XD`, PKD paths).
- **CSCA private keys are online** in this design (encrypted at rest; M13),
  which is what lets the service issue DSC certificates and CRLs automatically.
- The PKD directory is served by the backend's **built-in read-only LDAP**
  (`ldapjs` Bind/Search over the same DIT; uploads go through the application
  API, never LDAP). `deploy/openldap/` only holds the ICAO schema and a
  `slapd.conf` example for validating the LDIF dump.
- Data groups follow ICAO Doc 9303-10 §4.7 (reused code audited in
  [`packages/pki/AUDIT.md`](packages/pki/AUDIT.md)).
- Applicants submit structured fields only; images (DG2/DG5/DG7) are encoded in
  the browser and biometric templates (DG3/DG4) uploaded pre-encoded.

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
- **M9** PKD role: REST, LDIF dump, a built-in read-only LDAP server and the
  OpenLDAP LDIF schema — done.
- **M10** CSCA Master List generation, publication and verification — done.
- **M11** frontend (Nuxt 4 SPA + Naive UI): i18n (en), dark mode, API client,
  applicant/admin flows, masked preview and one-time claim — done.

See [`TODO.md`](TODO.md) for the full milestone plan.
