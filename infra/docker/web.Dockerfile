# syntax=docker/dockerfile:1.7
# =============================================================================
# YourStack web (Next.js dashboard) — multi-stage build of the standalone output.
#
# Build context MUST be the repository root (pnpm workspace lockfile + manifests).
#   - docker compose sets `context: ..` + this dockerfile path.
#   - Railway: service Root Directory = repo root, Dockerfile = infra/docker/web.Dockerfile.
#
# ASSUMPTIONS (documented in README):
#   1. apps/web/next.config.mjs sets `output: 'standalone'` (confirmed present).
#   2. Next.js emits the monorepo standalone tree at
#      apps/web/.next/standalone/apps/web/server.js with a traced node_modules.
#   3. NEXT_PUBLIC_API_URL is a *build-time* public var — Next inlines it into the
#      client bundle. It is provided via --build-arg (compose passes it through).
# =============================================================================

ARG NODE_VERSION=20-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
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
# NEXT_PUBLIC_* must be present at build time so Next can inline it.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter @yourstack/web build

# --- runtime: minimal standalone server ---------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# The standalone bundle is self-contained (traced node_modules included).
COPY --from=build /app/apps/web/.next/standalone ./
# Static assets are not part of the server bundle — copy them into the traced
# app directory so the standalone server can serve them.
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# Public assets (e.g. /install.sh, referenced by the API as ${PUBLIC_WEB_URL}/install.sh).
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Monorepo standalone entrypoint lives under apps/web/.
CMD ["node", "apps/web/server.js"]
