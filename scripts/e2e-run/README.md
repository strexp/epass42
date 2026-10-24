# ePass 42 end-to-end tests

The suite lives under `scripts/e2e-run/` and is split by functional scenario so a
failure names the certificate lifecycle it belongs to. Three groups run from
the same package:

| Group      | Command                                        | Needs                      | What it proves                                                     |
| ---------- | ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `packages` | `pnpm --filter @epass42/scripts test:packages` | nothing                    | `@epass42/pki` objects verify end to end                           |
| `backend`  | `pnpm --filter @epass42/scripts test:backend`  | starts a real backend      | The HTTP API issues, publishes, revokes, reviews and delivers      |
| `card42`   | `pnpm --filter @epass42/scripts test:card42`   | a built card42 + simulator | Backend-produced certificates/perso are accepted by the chip stack |

`pnpm --filter @epass42/scripts test` runs `packages` + `backend`; the `card42`
group is **skipped by default** because it needs a sibling checkout and Java Card
simulator.

## CI

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs four stages:

1. `check` — Prettier, ESLint and TypeScript for the whole workspace;
2. `unit` — every package except `@epass42/scripts`
   (`pnpm -r --filter '!@epass42/scripts' test`);
3. `e2e` — a matrix with one job per scenario group
   (`test:packages`, `test:backend`);
4. `build` — backend + frontend artifacts, only after the tests pass.

The `card42` suite is not part of hosted CI (it needs the external checkout and
the Java Card simulator); run it locally with `test:card42`.

## Layout

```
e2e-run/
├── fixtures/                 shared identities, documents, keys and CMS helpers
├── packages/                 pure @epass42/pki tests (no server, no files)
│   ├── pki.test.ts
│   └── lifecycle.test.ts
├── backend/                  real Fastify app on an ephemeral port
│   ├── harness.ts            startBackend(), cookie-jar HttpClient, loginAs()
│   ├── actions.ts            multi-step flows (issue a DSC/DV/terminal/passport)
│   ├── types.ts              response shapes asserted by the suites
│   ├── system/               health, config, OpenAPI, sessions, CSRF, rate limit, audit
│   ├── csca/                 applications, certificates, CRL, rollover, NIA DSC, delegation
│   ├── dsc/                  requests, preview, review, mode A/B delivery, passports
│   ├── cvca/                 DV applications, CV chain, rollover, default DV
│   ├── dv/                   terminal applications, clamping, NIA DV lifecycle
│   ├── ml/                   Master List Signer and Master List generation
│   └── pkd/                  REST directory, object downloads, revocations, LDIF
└── card42/                   cross-project suite (+ manual harness)
    ├── e2e.test.ts           backend → perso → simulator → CLI/ReadAll
    └── harness.ts            throws-away simulator, deploy, perso, CLI driver
```

## Part 1 — `packages/` (pure library)

Imports `@epass42/pki` (and `pkijs` for CMS inspection) only. No server, no
network, no files written. It exercises the Doc 9303-12 object lifecycle:

- CSCA → DSC issuance, profile validation and chain verification;
- CSCA key rollover link certificates (issuer, NameChange, signature);
- RSA-PSS CSCA/DSC chains and EF.SOD signatures;
- CRL creation, multiple revocations, CRL numbers and signature verification;
- EF.SOD signing over DG hashes, chain-to-CSCA and tamper detection;
- CSCA Master Lists over several CSCAs (duplicate suppression, CMS signature);
- DocumentType coverage, including the `I` wildcard;
- CVCA → DV → terminal authorization chains and restricted CHAT permissions;
- LDS2 Signer (TS/V/B) profile and chain.

## Part 2 — `backend/` (real HTTP)

Every test boots the production Fastify app (`buildApp`, as used by the
entrypoint) on an ephemeral loopback port, with in-memory SQLite and a temporary
data directory, then talks to it with `fetch` and real session cookies. The only
test double is the OIDC driver (`FakeOidc`). Requests that the UI would make are
used; raw SQL is only used to move a stored certificate's expiry into the past,
because expiry gates read the database column, not the certificate bytes.

### `system/`

- `/healthz`, `/api/config`, `/openapi.json` and the enabled-role surface;
- realm isolation, administrator vs. ordinary accounts and `reviewScope`;
- CSRF-protected logout and session invalidation;
- global rate limiting;
- realm audit logs, action-prefix filtering and paging.

### `csca/`

- submit / list / page / detail / reject / approve of DSC applications;
- subject, DocumentType and LDS2-role validation;
- `user_uploaded` keys through both a bare SPKI and a PKCS#10 CSR;
- LDS2 Signer issuance with ExtendedKeyUsage roles and ECDSA-only enforcement;
- PEM/DER certificate download and public registry filtering;
- one-time DSC private-key export (`no-store`, second call `410`, owner/admin);
- revocation by owner/admin, system signer protection and `409` re-revocation;
- signed CRL download (DER/PEM), manual generation, CRL number and PKD object;
- CSCA key rollover, link certificate publication and a CRL per issuing key
  (old revocations stay under the old issuer);
- NIA DSC rotation and `retired` publication;
- maintainer delegation (own DSC vs. NIA DSC) shared by the CSCA and DSC realms;
- exact-day DSC validity, certificate + private-key validity in `/csca/status`;
- expired owned DSCs are not offered as a delegation target;
- expired-CSCA gates for applications, approvals, NIA rotation and ML rotation.

### `dsc/`

- authenticated submission, schema/MRZ validation and the DG2 size limit;
- masked, non-destructive preview (no document number or raw images);
- listing/paging, owner vs. reviewer access and IP-based jurisdiction;
- own-DSC selection after delegation, foreign-DSC rejection and DocumentType
  mismatch at build time;
- reviewer detail view, approve/reject/regenerate and delegated MNT reviewers;
- mode A one-time reveal (`no-store`, concurrent claims → one `200` + one `410`);
- mode B reviewer queue and reviewer-only reveal;
- two-step landing token (view-only, reusable, expiry `410`);
- single active passport, self-service revoke, admin revoke and supersession by
  a newly approved document (also reflected in the PKD revocation list);
- delivery mode, issuing profile (security, LDS2, validity, DG2 limit);
- NIA DSC lifecycle gate for new requests and existing approvals.

### `cvca/` and `dv/`

- DV application submission, listing, rejection and permission/class override;
- CV certificate parsing and signature chain to the current CVCA;
- one-time DV key export and uploaded-key handling (SPKI + CSR);
- CVCA rollover with link certificate verification, trust-anchor publication and
  `/pkd/cvca` history;
- default (system) DV rotation, maintainer delegation and `cvca_expired` gate;
- `/cvca/status` and the CVCA-expiry gate on DV applications and approvals;
- terminal (IS) application, approval override, certificate/key delivery;
- terminal authorization clamped to the signing DV's grant;
- terminal validity clamped to the signing DV's expiry;
- NIA DV lifecycle gate, including when terminals are delegated to an own DV;
- DV audit trail.

### `ml/`

- administrator-only status, signer bootstrap and PKD publication;
- signed CSCA Master List generation, CMS signature/content/type verification;
- signer rotation (old signer retired), new lists signed by the new key;
- Master List includes every CSCA after a CSCA rollover;
- `ml_signer_expired` (generation) and `csca_expired` (rotation) gates.

### `system/`

- `/api/config` publishes the shared certificate validity limits used by the forms.

### `pkd/`

- every directory: `/pkd/{certificates,crls,cvca,dvs,dscs,ml-signers,masterlists}`;
- every object through `/pkd/objects/:id.{der,pem}`;
- revoked-document directory, hash lookup and MRZ canonicalisation via
  `POST /pkd/revoked/check`;
- LDIF rendering with all object classes/attributes.

## Part 3 — `card42/` (cross-project)

`test:card42` takes the real backend all the way to the chip. It:

1. starts the backend, issues a terminal chain, an LDS2 Signer and a document
   through the HTTP API, and claims the `.perso` script;
2. starts a fresh Java Card simulator in a temporary directory and loads the
   card42 CAPs (nothing is written inside the card42 checkout);
3. personalizes the chip with the backend's `.perso`;
4. runs card42's own CLI: full LDS1 read with PACE-MRZ and PACE-CAN, Chip
   Authentication, Terminal Authentication and Passive Authentication;
5. runs the exhaustive `ReadAll` reader: all DG hashes, EF.SOD chain and the
   DG3 TA gate (`6982` before PACE and before TA);
6. writes and reads back LDS2 Travel/Visa/Additional Biometrics records,
   verifies the LDS2 Signer profile/trust and exercises certificate reuse and
   the card-wide PACE-CAN inheritance;
7. proves a Travel-read-only terminal cannot append a Travel record (`6982`);
8. repeats the whole flow with an ECDSA and an RSA-PSS DSC/CSCA.

Prerequisites:

```bash
# card42 checkout with CAPs, host jars, configured simulator and GPPro
cd /path/to/card42 && make

# Java 21 (GPPro), globalplatformpro and a configured simulator at build/sim/jcsl
export CARD42=/path/to/card42
export GP_JAR=/usr/share/java/globalplatformpro/gp.jar   # optional
pnpm --filter @epass42/scripts test:card42
```

The harness uses `CARD42` (default `/home/yukari/misc/card42`), `GP_JAR`,
`JAVA` and `JAVAC`; set `CARD42_E2E=1` directly if calling `vitest`.

The older shell harness remains for debugging a specific card42 CLI invocation:

```bash
pnpm --filter @epass42/scripts exec tsx e2e-run/card42/gen.ts
pnpm --filter @epass42/scripts exec tsx e2e-run/card42/gen-restricted.ts
CARD42=/path/to/card42 e2e-run/card42/run-e2e.sh
```

`card42/REPORT.md` records the findings of the 2026-10-23 manual run.

## Fixtures

`fixtures/` holds the shared inputs:

- `identities.ts` — the dn42/OIDC identities and administrators;
- `documents.ts` — TD3/TD1 MRZ data, a real DG2 JPEG, rich data-group requests;
- `keys.ts` — SPKI, CSR and private-key helpers for `user_uploaded` flows;
- `certificates.ts` — CSCA/DSC, CV and LDS2 chains;
- `cms.ts` — Master List CMS inspection with `pkijs`;
- `assets/dg2.jpg`.

## Generated files

Private keys, certificates, CRLs, `.perso` scripts and logs produced by local
runs are ignored by `e2e-run/.gitignore` (`out*/`, `logs/`, `*.key`, `*.pem`,
`*.crt`, `*.der`, `*.cvc`, ...). The backend harness uses in-memory SQLite and a
temporary data directory; the card42 harness uses a temporary workspace.
