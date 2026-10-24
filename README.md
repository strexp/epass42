# ePass 42

ePass 42 is a dn42 public key infrastructure: a certificate directory (PKD), a
Country Signing Certificate Authority (CSCA) and a Document Signer (DSC) signing
service for eMRTD (passport and ID card) personalization.

## Repository layout

```
epass42/
├── packages/
│   ├── pki/       pure functions: X.509/CRL/CMS/SOD/MasterList/data groups/perso
│   └── shared/    zod schemas, types, error codes and constants (OIDs, country codes)
├── scripts/       e2e suite (packages + backend + card42 cross-project)
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

### Run the e2e tests

```bash
pnpm --filter @epass42/scripts test           # packages + backend (card42 skipped)
pnpm --filter @epass42/scripts test:packages  # library only (no server)
pnpm --filter @epass42/scripts test:backend   # boots the backend on a random port
pnpm --filter @epass42/scripts test:card42    # optional: backend → card42 simulator
```

See [`scripts/e2e-run/README.md`](scripts/e2e-run/README.md) for the scenario
layout, the lifecycle covered by each directory and the card42 prerequisites.

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

CSCA generation and certificate verification are done by the backend and
`packages/pki`; the standalone `scripts/gen-csca` / `scripts/verify` CLIs were
removed. `scripts/` now holds the scenario-split e2e suite, including the
optional card42 cross-project run ([`scripts/README.md`](scripts/README.md)).

## Design notes

- Country codes are configured once (`countryAlpha2`, `countryAlpha3`; defaults
  `XD`/`XDN`) and drive every derived value: the MRZ issuing state, the CSCA SAN
  locality, the default CRL distribution point and `GET /api/config` for the
  front end.
- **CSCA private keys are online** in this design (encrypted at rest; M13),
  which is what lets the service issue DSC certificates and CRLs automatically.
- The PKD directory is served by the backend's **built-in read-only LDAP**
  (`ldapjs` Bind/Search over the same DIT; uploads go through the application
  API, never LDAP). `deploy/openldap/` only holds the ICAO schema and a
  `slapd.conf` example for validating the LDIF dump.
- Data groups follow ICAO Doc 9303-10 §4.7 (reused code audited in
  [`packages/pki/AUDIT.md`](packages/pki/AUDIT.md)).
- Document types follow Doc 9303-12 §7.1.1: `P` (TD3 passport), `ID`/`IP`
  (TD1 cards) and the `I` wildcard; the built-in NIA DSC defaults to
  `["P", "I"]`, so one system DSC signs both passports and ID-1 documents.
- Applicants submit structured fields only; images (DG2/DG5/DG7) are encoded in
  the browser and biometric templates (DG3/DG4) uploaded pre-encoded.

## Status

- **M0** repository scaffolding, ESLint/Prettier, CI, constants — done.
- **M1** `packages/pki` (certificates, CRL, CMS/SOD/CardSecurity, Master List,
  data groups, MRZ, SecurityInfo, perso script, verification) — core done;
  ECDSA remains optional.
- **M2** CSCA/DSC generation and verification tooling — done; the standalone
  `scripts` CLIs were later retired in favour of `packages/pki` and the backend.
- **M3** backend skeleton: Fastify + zod/OpenAPI, SQLite/Drizzle schema and
  migrations, configuration, logging, health checks — done.
- **M4** dual-realm OIDC authentication (`/auth/{realm}/login|callback|logout|me`),
  SQLite sessions, dn42 claim mapping and MNT-based admin authorization
  (including delegated AS reviewers) — done.
- **M5** CSCA role: DSC applications, online issuance, revocation and key
  rollover — done.
- **M6** CRL generation with schedule-based refresh — done.
- **M7** DSC signing service: structured requests, TD1/TD3 DG1, DG/AA/CA/SOD/perso build — done.
- **M8** delivery: masked preview, one-time reveal, delivery modes and history — done.
- **M9** PKD role: REST, LDIF dump, a built-in read-only LDAP server and the
  OpenLDAP LDIF schema — done.
- **M10** CSCA Master List generation, publication and verification, now owned by the
  independent `ml` role with an administrator-only UI and public PKD reads — done.
- **M11** frontend (Nuxt 4 SPA + Naive UI): i18n (en), dark mode, API client,
  applicant/admin flows, masked preview and one-time claim — done.
- **M18** CSCA-issued LDS2 Signer certificates (LDS2-TS/V/B), certificate-type
  tagging in the registry and PKD, and the terminal-certificate audit page — done.

See [`TODO.md`](TODO.md) for the full milestone plan.
