# syntax=docker/dockerfile:1

# ePass 42 backend image (Fastify + SQLite/Drizzle).
#
# The service is started from TypeScript source with tsx: the workspace packages
# @epass42/pki and @epass42/shared are consumed as TS sources (their `exports`
# point at `src/index.ts`), and the backend's own `start` script is
# `node --import tsx src/index.ts`.  The container is designed to run *behind a
# reverse proxy*; TLS is handled there.
#
# Configuration is TOML-only (see backend/config.example.toml) and is therefore
# NOT baked into the image.  Mount it, and persist the SQLite database and
# generated artifacts on a volume:
#
#   docker run --rm -p 3000:3000 \
#     -v "$PWD/backend/config.toml:/app/backend/config.toml:ro" \
#     -v epass42-data:/app/backend/data \
#     epass42-backend
#
# Remember that inside the container the service must listen on a routable
# address: set `host = "0.0.0.0"` (and `env = "production"`) in config.toml.
#
# Build from the repository root (the build context must be the repo root):
#   docker build -f backend/Dockerfile -t epass42-backend .

FROM node:26-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Toolchain for native modules (better-sqlite3) when no prebuild is available.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.26.0
WORKDIR /app

COPY . .

# Installs the backend, its workspace dependencies (@epass42/pki, @epass42/shared)
# and the dev dependencies it needs at runtime (tsx, esbuild).  Host state is
# excluded by the root .dockerignore.
RUN pnpm install --frozen-lockfile --filter @epass42/backend...


FROM node:26-slim AS runtime
# Node's slim image does not ship ca-certificates, so install it, add the internal
# dn42 CA to the system trust store (see
# https://wiki.dn42/services/ca/Certificate-Authority/) and make Node load that
# store in addition to its bundled Mozilla CAs for outbound TLS (OIDC discovery,
# JWKS, …).
ENV NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY deploy/certs/dn42-root-ca.crt /usr/local/share/ca-certificates/dn42-root-ca.crt
RUN update-ca-certificates

# The pnpm virtual store keeps workspace packages linked by relative symlinks,
# so the directory layout must be preserved exactly as installed.
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/backend ./backend
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

WORKDIR /app/backend
RUN mkdir -p /app/backend/data
VOLUME ["/app/backend/data"]

# The host/port come from config.toml (defaults 127.0.0.1:3000 — set host to
# 0.0.0.0 for Docker).  EXPOSE documents the default only.
EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
