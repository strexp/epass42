# ePass 42 scripts

This package no longer ships CLI tools. The M2 `gen-csca` / `verify` commands and
the OpenSSL comparison script were removed; certificate generation and
verification now live in `packages/pki` and the backend.

What remains is the **e2e test suite** under `e2e-run/`, split by scenario:

- `e2e-run/packages/` — library-level tests using `@epass42/pki` only;
- `e2e-run/backend/` — integration tests that boot the real backend and drive it
  over HTTP, grouped by realm (`system/`, `csca/`, `dsc/`, `cvca/`, `dv/`,
  `ml/`, `pkd/`);
- `e2e-run/card42/` — optional cross-project suite that personalizes the card42
  simulator with backend-produced certificates and a `.perso` script.

```bash
pnpm --filter @epass42/scripts test            # packages + backend (card42 skipped)
pnpm --filter @epass42/scripts test:packages   # package-level only
pnpm --filter @epass42/scripts test:backend    # backend only
pnpm --filter @epass42/scripts test:card42     # card42 simulator (needs CARD42)
```

See [`e2e-run/README.md`](e2e-run/README.md) for the suite layout, the certificate
lifecycle covered by each directory, and the card42 prerequisites.
