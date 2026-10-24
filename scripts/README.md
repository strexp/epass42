# ePass 42 scripts

This package no longer ships CLI tools. The M2 `gen-csca` / `verify` commands and
the OpenSSL comparison script were removed; certificate generation and
verification now live in `packages/pki` and the backend.

What remains is the **e2e test suite** under `e2e-run/`, split in two:

- `e2e-run/packages/` — library-level tests using `@epass42/pki` only;
- `e2e-run/backend/` — integration tests that boot the real backend and drive it
  over HTTP.

```bash
pnpm --filter @epass42/scripts test            # both suites
pnpm --filter @epass42/scripts test:packages   # package-level only
pnpm --filter @epass42/scripts test:backend    # backend only
```

`e2e-run/card42/` keeps the manual card42 chip/simulator harness; it is not part
of `pnpm test`. See [`e2e-run/README.md`](e2e-run/README.md) for the suite layout
and for how to run the manual harness.
