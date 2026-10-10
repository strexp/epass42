# Deployment

ePass 42 ships as **two Docker images**:

| Image                             | Contents                            | Base                |
| --------------------------------- | ----------------------------------- | ------------------- |
| `ghcr.io/strexp/epass42-frontend` | Nuxt SPA (static), served by nginx  | `nginx:alpine-slim` |
| `ghcr.io/strexp/epass42-backend`  | Fastify API + SQLite (run with tsx) | `node:26-slim`      |

Both are **multi-arch** (`linux/amd64` and `linux/arm64`) and designed to run
**behind a reverse proxy** that terminates TLS; the containers themselves serve
plain HTTP.

## Frontend

Built with `nuxt generate` (a client-rendered SPA) and served by nginx. The image
is deployment-agnostic: the backend origin is injected at **container start**,
not baked in at build time.

| Environment variable    | Default   | Meaning                                            |
| ----------------------- | --------- | -------------------------------------------------- |
| `EPASS42_FRONTEND_HOST` | `0.0.0.0` | Address nginx listens on inside the container.     |
| `EPASS42_FRONTEND_PORT` | `8080`    | Port nginx listens on inside the container.        |
| `EPASS42_API_BASE`      | _(empty)_ | Backend origin the SPA calls. Empty = same origin. |

The bundle is built with the placeholder `__EPASS42_API_BASE__`; the entrypoint
hook `deploy/frontend/40-epass42-api-base.sh` replaces it with `$EPASS42_API_BASE`
in every generated HTML shell before nginx starts. A `/healthz` endpoint is
served on the same listener.

```sh
# Cross-origin: frontend at app.example.net, API at api.example.net.
docker run --rm -p 8080:8080 \
  -e EPASS42_API_BASE=https://api.example.net \
  ghcr.io/strexp/epass42-frontend:latest

# Same-origin: the reverse proxy fronts one host and routes the API itself.
docker run --rm -p 8080:8080 -e EPASS42_API_BASE= \
  ghcr.io/strexp/epass42-frontend:latest
```

## Backend

Configuration is **TOML-only** (`backend/config.example.toml`); it is not read
from the environment, so mount a `config.toml`:

- `/app/backend/config.toml` – configuration (read-only bind mount recommended).
- `/app/backend/data` – SQLite database, KEK and generated artifacts (volume).

Inside the container, set at least:

```toml
env = "production"
host = "0.0.0.0"            # 127.0.0.1 would only be reachable inside the container
port = 3000
publicUrl = "https://api.example.net"
frontendUrl = "https://app.example.net"
sessionSecret = "…"          # >= 16 chars, must not be the dev default in production
cookieSecure = true          # true when the public origin is HTTPS
trustProxy = true            # if the reverse proxy forwards X-Forwarded-For
```

The service starts with `node --import tsx src/index.ts` (the workspace packages
are consumed as TypeScript source). Exposes `3000` by default.

The image trusts the internal **dn42 CA** (`deploy/certs/dn42-root-ca.crt`,
installed into `/usr/local/share/ca-certificates/`) and sets `NODE_USE_SYSTEM_CA=1`,
so Node validates `*.dn42` endpoints (OIDC issuer discovery, JWKS, …) in addition
to its bundled Mozilla CAs. See the [dn42 CA page](https://wiki.dn42/services/ca/Certificate-Authority/).

```sh
docker run --rm -p 127.0.0.1:3000:3000 \
  -v "$PWD/backend/config.toml:/app/backend/config.toml:ro" \
  -v epass42-data:/app/backend/data \
  ghcr.io/strexp/epass42-backend:latest
```

## docker-compose

`deploy/docker-compose.yml` wires both containers on loopback for a host reverse
proxy:

```sh
cp backend/config.example.toml backend/config.toml   # then edit it
docker compose -f deploy/docker-compose.yml up -d
```

## Reverse proxy notes

- Give the frontend and the API **the same registrable site** (e.g.
  `app.example.net` and `api.example.net`). Auth cookies are `SameSite=Lax`, so
  two unrelated domains would drop them on cross-site requests.
- `frontendUrl` (backend) and the frontend origin must match; the backend only
  allows that origin via CORS.
- A same-origin setup is possible with a path prefix (e.g. proxy `/api` → backend
  and strip the prefix) and `EPASS42_API_BASE=` — remember to also set the
  backend's `publicUrl` to the prefixed public URL so OAuth redirects resolve.
- Forward the client `Host` and the public scheme (`X-Forwarded-Proto`) to the
  containers. The frontend vhost sets `absolute_redirect off` and serves
  prerendered routes without a trailing-slash redirect, so it never advertises
  its internal scheme/port; the backend should run with `trustProxy = true` so
  it honours `X-Forwarded-*`.

## Building locally

The build context is the **repository root** (the pnpm workspace lives there):

```sh
docker build -f frontend/Dockerfile -t epass42-frontend .
docker build -f backend/Dockerfile  -t epass42-backend  .
```

## CI / release

- `.github/workflows/ci.yml` – checks, then builds the backend `dist` and the
  static frontend bundle and uploads them as workflow artifacts. Once the checks
  and build pass on a default branch _and_ the commit is still the branch head,
  it publishes both images to GHCR as `latest`.
- `.github/workflows/docker-build.yml` – reusable workflow that builds each
  architecture on a native runner (`ubuntu-24.04` for `linux/amd64`,
  `ubuntu-24.04-arm` for `linux/arm64`) and assembles the multi-arch manifest.
- `.github/workflows/release.yml` – on a `v*` tag, pushes both images to GHCR and
  creates a **draft** GitHub release with the bundles attached.

## Publishing the `packages/*` libraries (analysis only — not implemented)

The workspace libraries `@epass42/pki` and `@epass42/shared` could be published
to the GitHub Packages npm registry, but it needs more than a workflow:

1. **Scope must match the owner.** GitHub Packages requires an npm scope equal to
   the repository owner (`@strexp`), so `@epass42/pki` / `@epass42/shared` would
   have to be renamed, which affects every import across the workspace.
2. **They are TS source, not build outputs.** `main`/`exports` point at
   `src/index.ts` and the packages are `private`. To publish, they need real
   build outputs (`dist/*.js` + `.d.ts`), a proper `exports` map, `files`, and
   `private` removed.
3. **Auth/versioning.** Publishing uses
   `NODE_AUTH_TOKEN=${{ secrets.GITHUB_TOKEN }}` with `packages: write`, and the
   versions need a release strategy (manual bumps or changesets);
   `workspace:*` deps are rewritten by `pnpm publish`.
4. **Consumers.** Nothing outside this repository currently imports them, so
   publishing would only be useful for external reuse of the PKI kernel.

Verdict: feasible, but it is a packaging refactor (scope + build + versioning),
not just a workflow. Deferred.
