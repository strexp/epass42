# syntax=docker/dockerfile:1

# ePass 42 frontend image.
#
# Builds the Nuxt SPA as a fully static bundle (`nuxt generate`) and serves it
# with nginx:alpine-slim.  The container is designed to run *behind a reverse
# proxy* and does not terminate TLS itself.
#
# Two things are configurable at runtime, so a single image works for every
# deployment:
#
#   * EPASS42_FRONTEND_HOST / EPASS42_FRONTEND_PORT - the address nginx listens
#     on inside the container (default 0.0.0.0:8080).
#   * EPASS42_API_BASE - the backend origin baked into the SPA.  The bundle is
#     built with the literal placeholder `__EPASS42_API_BASE__`, which the
#     entrypoint substitutes with this value before nginx starts.  Leave it empty
#     for a same-origin (path-prefixed) deployment, or set it to e.g.
#     `https://api.example.net` for a cross-origin one.
#
# Build from the repository root (the build context must be the repo root):
#   docker build -f frontend/Dockerfile -t epass42-frontend .
#
# Run:
#   docker run --rm -p 8080:8080 \
#     -e EPASS42_FRONTEND_HOST=0.0.0.0 \
#     -e EPASS42_FRONTEND_PORT=8080 \
#     -e EPASS42_API_BASE=https://api.example.net \
#     epass42-frontend

FROM node:26-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@11.26.0
WORKDIR /app

# The whole workspace is copied; the frontend depends on @epass42/shared.  Any
# host state (node_modules, .output, …) is excluded by the root .dockerignore.
COPY . .

# Only the frontend and its workspace dependencies are installed.
RUN pnpm install --frozen-lockfile --filter @epass42/frontend...

# Placeholder value substituted at container start (see the entrypoint below).
ARG NUXT_PUBLIC_API_BASE=__EPASS42_API_BASE__
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE
RUN pnpm --filter @epass42/frontend generate


FROM nginx:alpine-slim AS runtime

# nginx renders this template to /etc/nginx/conf.d/default.conf at startup,
# substituting the defined EPASS42_FRONTEND_HOST / EPASS42_FRONTEND_PORT
# environment variables (the official image's 20-envsubst-on-templates.sh step).
COPY deploy/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template

# Rewrites the API-base placeholder in the generated HTML before nginx starts.
COPY deploy/frontend/40-epass42-api-base.sh /docker-entrypoint.d/40-epass42-api-base.sh
RUN chmod +x /docker-entrypoint.d/40-epass42-api-base.sh

COPY --from=build /app/frontend/.output/public /usr/share/nginx/html

ENV EPASS42_FRONTEND_HOST=0.0.0.0 \
    EPASS42_FRONTEND_PORT=8080 \
    EPASS42_API_BASE=

EXPOSE 8080

# ENTRYPOINT and CMD are inherited from the nginx image: the entrypoint runs the
# /docker-entrypoint.d/ hooks and then starts nginx in the foreground.
