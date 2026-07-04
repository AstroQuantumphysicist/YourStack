# syntax=docker/dockerfile:1.7
# =============================================================================
# YourStack API (Fastify control-plane) — multi-stage, pnpm + turbo aware.
#
# IMPORTANT: the build context MUST be the repository root. A pnpm workspace
# needs the root lockfile and every package manifest to install reproducibly.
#   - docker compose sets `context: ..` (repo root) + this dockerfile path.
#   - Railway: set the service Root Directory to the repo root and point the
#     Dockerfile path at apps/api/Dockerfile.
#
# The runtime stage keeps the resolved workspace node_modules (including the
# Prisma CLI + generated client + migrations) so `prisma migrate deploy` can be
# run as a release/pre-deploy step from the exact image that runs the service.
# Slimming this further (pnpm deploy --prod) is tracked as future hardening.
# =============================================================================

ARG NODE_VERSION=20-slim

# --- base: node + pnpm via corepack + openssl (Prisma query engine needs it) --
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- deps: install with full (dev) deps using only manifests for layer caching -
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json      apps/api/package.json
COPY apps/worker/package.json   apps/worker/package.json
COPY apps/web/package.json      apps/web/package.json
COPY apps/cli/package.json      apps/cli/package.json
COPY apps/mcp/package.json      apps/mcp/package.json
COPY packages/config/package.json    packages/config/package.json
COPY packages/db/package.json        packages/db/package.json
COPY packages/security/package.json  packages/security/package.json
COPY packages/shared/package.json    packages/shared/package.json
RUN pnpm install --frozen-lockfile

# --- build: copy sources, generate Prisma client, bundle the API with tsup -----
FROM deps AS build
COPY . .
RUN pnpm --filter @yourstack/db generate \
 && pnpm --filter @yourstack/api build

# --- runtime -------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Copy the fully-resolved workspace (dist + node_modules + prisma schema/migrations).
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
# Healthcheck hits the Fastify /health route (Railway/compose also use it).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
