# YourStack Deployment Guide

This guide covers deploying the YourStack **control plane** — the `api`, `worker`,
Postgres, and Redis. (The **data plane** is your fleet of nodes, each running the
agent; joining a node is covered in the [README](../README.md#your-first-deployment).)

Two supported paths:

1. [Railway](#1-railway) — the primary, recommended target (config-as-code).
2. [Self-hosting with Docker Compose](#2-self-hosting-docker-compose) — any box or
   VM you control.

Both share the same [migration strategy](#3-migration-strategy),
[scaling](#4-scaling), and [backups](#5-backups) sections below.

---

## 0. Build & runtime facts

The api and worker are ESM apps bundled by **tsup** into a single
`dist/index.js`; internal `@yourstack/*` packages are inlined, `@prisma/client` is
kept external. Their real commands (from each `package.json`):

| App | build | start |
| --- | --- | --- |
| `@yourstack/api` | `tsup` → `apps/api/dist/index.js` | `node dist/index.js` |
| `@yourstack/worker` | `tsup` → `apps/worker/dist/index.js` | `node dist/index.js` |
| `@yourstack/web` | `next build` (standalone) | `node apps/web/server.js` |

The Prisma client is generated with `pnpm --filter @yourstack/db generate` and
needs **openssl** at runtime (installed in the Dockerfiles). Migrations are
`pnpm --filter @yourstack/db migrate:deploy`.

Canonical Dockerfiles: `apps/api/Dockerfile`, `apps/worker/Dockerfile`,
`infra/docker/web.Dockerfile`. **All build with the repo root as context** —
a pnpm workspace needs the root lockfile and every package manifest.

---

## 1. Railway

### 1.1 Project & datastores

Create one Railway **project**. Add **PostgreSQL** and **Redis**
(New → Database). They expose reference variables `${{Postgres.DATABASE_URL}}` and
`${{Redis.REDIS_URL}}`. Keep everything in the **same project** so services share
the private network.

### 1.2 Create the app services

Add three services from your repo: **api**, **worker**, **web**. For each:

- **Root Directory = the repo root** (not `apps/api`). The Dockerfile build
  context must include the monorepo lockfile + manifests; the per-service
  `railway.toml` sets `dockerfilePath` to the correct Dockerfile.
- **Config-as-code file**:
  - api → `apps/api/railway.toml`
  - worker → `apps/worker/railway.toml`
  - web → copy `infra/railway/web.railway.toml` to `apps/web/railway.toml`, or set
    the equivalent builder/start/`NEXT_PUBLIC_API_URL` build arg in the UI.

The committed `railway.toml` files already set builder `DOCKERFILE`, the start
command, healthcheck path, and restart policy:

```toml
# apps/api/railway.toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "apps/api/Dockerfile"

[deploy]
preDeployCommand = "pnpm --filter @yourstack/db migrate:deploy"
startCommand = "node dist/index.js"
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

### 1.3 Variables

Set on **api + worker**:

```
DATABASE_URL           = ${{Postgres.DATABASE_URL}}
REDIS_URL              = ${{Redis.REDIS_URL}}
SESSION_SECRET         = <openssl rand -hex 32>
SECRETS_ENCRYPTION_KEY = <openssl rand -hex 32>   # exactly 64 hex chars
NODE_ENV               = production
```

api-only:

```
PUBLIC_API_URL  = https://api.<domain>
PUBLIC_WEB_URL  = https://app.<domain>
CORS_ORIGINS    = https://app.<domain>
ADMIN_EMAILS    = you@example.com
BASE_PREVIEW_DOMAIN = preview.<domain>
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_WEBHOOK_SECRET  (optional)
```

web-only:

```
NEXT_PUBLIC_API_URL = https://api.<domain>   # BUILD-TIME arg (Next inlines it)
```

Do **not** set `PORT` — Railway injects it, and the apps bind to it.

### 1.4 First deploy

Deploy api first. Its `preDeployCommand` runs `prisma migrate deploy` inside the
freshly built image before traffic shifts. Confirm `/health` is green and
`/ready` returns `200` (Postgres + Redis reachable), then deploy worker and web.
Point custom domains at the api and web services.

---

## 2. Self-hosting (Docker Compose)

`infra/docker-compose.yml` runs the whole control plane locally or on a single
host. It builds the api/worker/web images from the canonical Dockerfiles (context
= repo root) and applies migrations via a one-shot `migrate` service before
api/worker start.

```bash
cp infra/.env.example infra/.env      # fill in real secrets
# generate: openssl rand -hex 32  (SESSION_SECRET and SECRETS_ENCRYPTION_KEY)
docker compose -f infra/docker-compose.yml up -d --build
```

Services:

| Service | Port | Notes |
| --- | --- | --- |
| postgres | 5432 | healthcheck, named volume `postgres_data` |
| redis | 6379 | AOF persistence, volume `redis_data` |
| migrate | — | one-shot `prisma migrate deploy`, then exits 0 |
| api | 4000 | waits for postgres+redis healthy **and** migrate completed |
| worker | — | same dependencies |
| web | 3000 | `NEXT_PUBLIC_API_URL` passed as build arg |
| caddy | 8080/8443 | profile `proxy`: single-origin reverse proxy |
| agent | — | profile `nodes`: a dev node agent (needs `YOURSTACK_JOIN_TOKEN`) |

`DATABASE_URL`/`REDIS_URL` are pinned to the compose network hosts, so they are
correct regardless of the `.env` file. Enable the optional pieces:

```bash
docker compose -f infra/docker-compose.yml --profile proxy up -d   # + caddy
docker compose -f infra/docker-compose.yml --profile nodes up -d   # + agent
```

For a production self-host, front the stack with a TLS-terminating reverse proxy
(Caddy/Nginx/Traefik), set `NODE_ENV=production` and real secrets, put Postgres on
managed storage or a backed-up volume, and run behind a process supervisor or
orchestrator.

---

## 3. Migration strategy

- **Single owner.** The **api** service owns migrations (Railway
  `preDeployCommand`; compose `migrate` one-shot). The worker never migrates —
  this avoids two services racing the same migration.
- **`migrate deploy`, never `migrate dev` in production.** `deploy` applies
  committed migrations only and never generates or resets.
- **Forward-only.** Write additive, backward-compatible migrations so the old app
  version keeps working while the new one rolls out (expand → migrate → contract).
- **Drift protection in CI.** `.github/workflows/ci.yml` runs
  `prisma migrate diff --exit-code` against a Postgres service, failing the build
  if `schema.prisma` has changes not captured by a migration.
- **The runtime image ships the Prisma toolchain** (CLI + schema + migrations), so
  `migrate deploy` runs from the exact image that serves traffic.

---

## 4. Scaling

- **API** is stateless — scale horizontally (`numReplicas` on Railway, more
  replicas behind a load balancer self-hosted). SSE still works across instances
  because events fan out over the single Redis pub/sub channel (`yourstack:events`).
- **Worker** scales horizontally too; BullMQ distributes jobs. Per-queue
  concurrency is set in `apps/worker/src/index.ts` (DEPLOY 4, WEBHOOK 8,
  HEALTHCHECK 8, ROLLBACK 4, DOMAIN 4, MAINTENANCE 2). Run **one logical worker
  fleet**; the repeatable maintenance jobs are idempotent, but keep replica counts
  modest to avoid redundant maintenance churn.
- **Postgres/Redis** are the scaling floor — use a managed Postgres with adequate
  connections (Prisma pools per instance) and a Redis with enough memory for
  queues + pub/sub. Watch the `/metrics` gauges (`yourstack_commands_queued`,
  `yourstack_nodes_online`) to size the fleet.
- **Data plane** scales by adding nodes; each node's capacity is bounded by its own
  hardware and the plan's `maxNodes`/`maxApps`.

---

## 5. Backups

- **Postgres is the source of truth** — back it up. On Railway use the managed
  Postgres backup/restore; self-hosted, schedule `pg_dump` (or continuous WAL
  archiving) and test restores.
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --file=yourstack-$(date +%F).dump
  ```
- **Secrets are only recoverable with `SECRETS_ENCRYPTION_KEY`.** A database backup
  is useless without the key, and losing the key makes every stored secret
  unrecoverable. **Back up the key separately** in a secrets manager, and rotate it
  deliberately (the `v1:` ciphertext prefix reserves room for versioned
  re-encryption).
- **Redis** holds queues + transient pub/sub; it is not a system of record. Losing
  Redis loses in-flight jobs, not committed state. AOF persistence (enabled in
  compose) reduces job loss on restart.
- Keep infra config (`railway.toml`, `docker-compose.yml`, `.env` templates) in
  version control; keep actual secret values out of the repo.

---

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| App won't boot, config error | The error names the offending env var — cross-check the [env table](../README.md#environment-variables). `SECRETS_ENCRYPTION_KEY` must be 64 hex chars. |
| `/ready` returns 503 | `checks` field shows which of `db`/`redis` is down. |
| Migrations fail on deploy | Ensure api Root Directory = repo root; the pre-deploy command runs in the built image. |
| SSE events missing on some requests | Confirm all API instances share the same Redis. |
| Node never comes online | Join token expires in 15 min and is single-use; check the agent reaches `PUBLIC_API_URL` and heartbeats every 15s. |
| Web shows wrong API URL | `NEXT_PUBLIC_API_URL` is **build-time** — rebuild the web image after changing it. |
