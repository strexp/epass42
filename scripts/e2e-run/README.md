# ePass 42 end-to-end tests

Two suites, both under `scripts/e2e-run/` and run by `pnpm test`:

| Suite      | Command                                        | Needs a backend? | What it proves                                                      |
| ---------- | ---------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `packages` | `pnpm --filter @epass42/scripts test:packages` | no               | The PKI objects built by `@epass42/pki` verify end to end           |
| `backend`  | `pnpm --filter @epass42/scripts test:backend`  | starts one       | The real HTTP API issues, publishes, revokes and delivers artefacts |

Run everything with:

```bash
pnpm --filter @epass42/scripts test
```

## Part 1 — `packages/` (pure library)

Imports `@epass42/pki` (and `pkijs` for CMS inspection) only; no server, no
network, no files written. It exercises the object lifecycle of Doc 9303-12:

- CSCA → DSC issuance, profile validation and chain verification;
- CRL creation, signature verification, revocation lookup and CRL number;
- EF.SOD signing over DG hashes, chain-to-CSCA and tamper detection;
- CSCA Master List signing and CMS signature verification;
- CVCA → DV → terminal authorization chains and CHAT permissions;
- LDS2 Signer (TS/V/B) profile and chain.

## Part 2 — `backend/` (real HTTP)

Each test boots the production Fastify app (`buildApp`, as used by the
entrypoint) on an ephemeral loopback port, with in-memory SQLite and a temporary
data directory, then talks to it with `fetch` and real session cookies. Only the
OIDC driver is a test double (`FakeOidc`), so no identity provider is required.

Covered:

- `/healthz` and `/api/config` over HTTP;
- CSCA application → approval → DSC download, with the issued certificate
  checked by `packages/pki` against the live CSCA;
- PKD publication of the new DSC;
- revocation, CRL download and CRL signature/entry verification;
- applicant flow: submit → masked preview → admin approval → one-time reveal
  (`cache-control: no-store`, second claim `410`).

`backend/harness.ts` contains the reusable pieces: `startBackend()`,
`HttpClient` (cookie jar) and `loginAs()` (completes the fake OIDC redirect).

## Fixtures

`fixtures/` holds the shared inputs: `certificates.ts` (CSCA/DSC, CV and LDS2
chains), `documents.ts` (MRZ + DG2 signing request) and `assets/dg2.jpg`.

## `card42/` — manual cross-project harness

The card42 chip/simulator checks predate this suite and need a sibling `card42`
checkout plus the Java Card simulator, so they are **not** part of `pnpm test`.
They are kept for manual regression runs:

```bash
# 1. generate CSCA/DSC/CV/LDS2 fixtures and the .perso script
pnpm --filter @epass42/scripts exec tsx e2e-run/card42/gen.ts
pnpm --filter @epass42/scripts exec tsx e2e-run/card42/gen-restricted.ts

# 2. drive card42 against a running simulator (set CARD42 if not the default)
CARD42=/path/to/card42 e2e-run/card42/run-e2e.sh
```

`card42/REPORT.md` records the findings of the 2026-10-23 run.

## Generated files

Private keys, certificates, CRLs, `.perso` scripts and logs produced by local
runs are ignored by `e2e-run/.gitignore` (`out*/`, `logs/`, `*.key`, `*.pem`,
`*.crt`, `*.der`, `*.cvc`, ...).
