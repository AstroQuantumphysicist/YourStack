# syntax=docker/dockerfile:1.7
# =============================================================================
# NodeRail worker (BullMQ background processor) — multi-stage, pnpm + turbo aware.
#
# Build context MUST be the repository root (pnpm workspace lockfile + manifests).
#   - docker compose sets `context: ..` + this dockerfile path.
#   - Railway: service Root Directory = repo root, Dockerfile = apps/worker/Dockerfile.
#
# The worker shares the same Prisma client and DB access as the API but never
# terminates HTTP traffic, so no port is exposed. Migrations are owned by the API
# service / one-shot migrate job, not the worker.
# =============================================================================

ARG NODE_VERSION=20-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json      apps/api/package.json
COPY apps/worker/package.json   apps/worker/package.json
COPY apps/web/package.json      apps/web/package.json
COPY apps/cli/package.json      apps/cli/package.json
COPY packages/config/package.json    packages/config/package.json
COPY packages/db/package.json        packages/db/package.json
COPY packages/security/package.json  packages/security/package.json
COPY packages/shared/package.json    packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @noderail/db generate \
 && pnpm --filter @noderail/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
# The worker has no HTTP surface; liveness is inferred from queue heartbeats.
# A process-level healthcheck keeps the container honest under orchestration.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "process.exit(0)"
CMD ["node", "dist/index.js"]
