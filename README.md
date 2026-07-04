<div align="center">

# NodeRail

### Bring your own server. We turn it into a cloud.

A production "bring your own compute" (BYOC) platform — the Railway/Vercel
developer experience, running on **servers you own**. Connect a node, connect
GitHub, `git push`, and NodeRail builds, deploys, health-checks, and routes
traffic to your app on your own hardware.

[![CI](https://github.com/noderail/noderail/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-orange.svg)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org)

</div>

---

## Table of contents

- [What is NodeRail?](#what-is-noderail)
- [Architecture overview](#architecture-overview)
- [Monorepo layout](#monorepo-layout)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Deploying to Railway](#deploying-to-railway)
- [Your first deployment](#your-first-deployment)
- [Further documentation](#further-documentation)
- [What's implemented / future hardening](#whats-implemented--future-hardening)
- [License](#license)

---

## What is NodeRail?

Most PaaS products rent you _their_ compute. NodeRail flips that: you run a small
signed **agent** on any Linux server you control (a VPS, a homelab box, a bare
metal rack), and the NodeRail **control plane** turns it into a first-class
deploy target with the workflow you expect from a modern cloud:

- **Git-driven deploys** — connect a GitHub repo, push to a branch, get a build.
- **Full pipeline** — checkout → install → test → build → package → deploy →
  healthcheck → finalize, streamed live to the dashboard.
- **Preview environments** — every pull request gets its own preview deployment
  and domain.
- **Automatic HTTPS** — the agent manages a Caddy edge with Let's Encrypt.
- **Secrets, domains, rollbacks, logs, metrics, RBAC, audit** — the boring-but-
  essential platform primitives, done properly.
- **Safety by construction** — the agent executes only **typed, signed commands**;
  there is deliberately no "run arbitrary shell" capability.

The **control plane** (this repo's `api` + `worker` + Postgres + Redis) is itself
designed to be hosted on a managed platform such as **Railway**. The **data
plane** is your fleet of nodes.

---

## Architecture overview

```
                          ┌───────────────────────────────────────────────┐
                          │                CONTROL PLANE                    │
                          │             (host on Railway, etc.)             │
   ┌──────────┐   HTTPS   │  ┌──────────┐   BullMQ    ┌───────────────┐    │
   │  Web /   │──────────▶│  │   API    │◀──jobs────▶ │    Worker      │    │
   │  CLI     │  cookies  │  │ (Fastify)│            │ (deploy pipeline│    │
   └──────────┘  /Bearer  │  └────┬─────┘            │  + maintenance) │    │
        ▲                 │       │  ▲                └───────┬────────┘    │
        │ SSE (events)    │       │  │ pub/sub                │             │
        │                 │  ┌────▼──┴────┐  ┌─────────────┐  │             │
        │                 │  │  Postgres  │  │    Redis     │◀─┘             │
        │                 │  │  (Prisma)  │  │ queues+pubsub│                │
        │                 │  └────────────┘  └─────────────┘                │
        │                 └───────────────────────┬─────────────────────────┘
        │                          signed, typed  │  register / heartbeat /
        │                          commands (HMAC) │  poll / result / logs
        │                                          ▼
        │                 ┌───────────────────────────────────────────────┐
        │                 │                 DATA PLANE                      │
        │                 │            (servers you own)                    │
        │                 │  ┌─────────────┐        ┌─────────────┐        │
        └─────logs────────│  │ Node agent  │───────▶│   Docker     │        │
                          │  │  (Rust)     │ manages│  app         │        │
                          │  └──────┬──────┘        │  containers  │        │
                          │         │ writes        └─────────────┘        │
                          │         ▼                                       │
                          │  ┌─────────────┐   auto-HTTPS / routing         │
                          │  │    Caddy     │◀──── inbound app traffic       │
                          │  └─────────────┘                                │
                          └───────────────────────────────────────────────┘
```

- **API** (`apps/api`, Fastify) — REST + OAuth + SSE, terminates all user and
  agent traffic, signs commands, verifies webhooks.
- **Worker** (`apps/worker`, BullMQ) — runs the deployment pipeline, webhook
  processing, health checks, domain verification, and scheduled maintenance.
- **Postgres** (Prisma) — the single source of truth.
- **Redis** — BullMQ queues **and** the pub/sub bus that fans out SSE events
  across API instances.
- **Agent** (`apps/agent`, Rust) — registers a node, sends heartbeats/telemetry,
  polls for signed commands, executes them against Docker, and streams logs back.

For the deep dive, see **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**.

---

## Monorepo layout

```
noderail/
├── apps/
│   ├── api/          Fastify control-plane API (ESM, bundled with tsup)
│   │   ├── Dockerfile          canonical multi-stage image
│   │   └── railway.toml        Railway config-as-code (api service)
│   ├── worker/       BullMQ background worker
│   │   ├── Dockerfile
│   │   └── railway.toml
│   ├── web/          Next.js dashboard (standalone output)
│   ├── cli/          `noderail` CLI
│   └── agent/        Rust node agent (runs on user servers)
├── packages/
│   ├── config/       Typed env loading (zod) — the authoritative env list
│   ├── db/           Prisma schema, migrations, seed
│   ├── security/     Encryption, HMAC signing, tokens, redaction, RBAC
│   └── shared/       Constants, enums, RBAC catalog, zod schemas, queue names
├── infra/
│   ├── docker-compose.yml      local dev stack
│   ├── .env.example            compose env template
│   ├── docker/                 web.Dockerfile, agent.Dockerfile
│   ├── caddy/Caddyfile         sample node edge config
│   └── railway/web.railway.toml  Railway template for the web service
├── docs/             ARCHITECTURE, SECURITY, DEPLOYMENT, API, checklists
├── .github/workflows/ci.yml    CI (Node + Rust + Docker builds)
├── package.json      root scripts (turbo)
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Local development

### 1. Install

```bash
corepack enable                 # ensures pnpm 9 is available
pnpm install                    # installs the whole workspace
```

### 2. Configure environment

```bash
cp .env.example .env                 # for `pnpm dev` (runs apps on your host)
cp infra/.env.example infra/.env     # for the docker-compose stack
```

Generate real secrets for anything you expose:

```bash
openssl rand -hex 32   # use for SESSION_SECRET
openssl rand -hex 32   # use for SECRETS_ENCRYPTION_KEY (must be 64 hex chars)
```

### 3. Start backing services

`pnpm docker:up` runs the full compose stack (Postgres, Redis, and the api /
worker / web images). During day-to-day app development you usually only need the
databases — run just those and use `pnpm dev` for hot reload:

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis
```

The compose stack applies migrations automatically via a one-shot `migrate`
service before `api`/`worker` start. If you run only Postgres/Redis, apply them
yourself:

```bash
pnpm db:migrate     # prisma migrate deploy
pnpm db:seed        # optional demo workspace/user
```

### 4. Run the apps

```bash
pnpm dev            # all apps in watch mode (turbo --parallel)
```

Or run them individually:

| App | Command | Port |
| --- | --- | --- |
| API | `pnpm --filter @noderail/api dev` | 4000 |
| Worker | `pnpm --filter @noderail/worker dev` | (no HTTP) |
| Web | `pnpm --filter @noderail/web dev` | 3000 |
| CLI | `pnpm --filter @noderail/cli build && node apps/cli/dist/index.js` | — |

Health checks: `curl localhost:4000/health` (liveness) and
`curl localhost:4000/ready` (checks Postgres + Redis). API docs are served at
`http://localhost:4000/docs` (Swagger UI) and `http://localhost:4000/openapi.json`.

### 5. Test the reverse proxy / a dev node (optional)

```bash
# Front web + api behind a single Caddy origin on http://localhost:8080
docker compose -f infra/docker-compose.yml --profile proxy up -d

# Run a dev node agent joined to the compose network (needs a join token)
NODERAIL_JOIN_TOKEN=nrj_... docker compose -f infra/docker-compose.yml --profile nodes up -d agent
```

### Useful root scripts

| Script | Does |
| --- | --- |
| `pnpm docker:up` / `pnpm docker:down` / `pnpm docker:logs` | manage the compose stack |
| `pnpm db:migrate` | `prisma migrate deploy` |
| `pnpm db:migrate:dev` | create + apply a new migration |
| `pnpm db:seed` | seed demo data |
| `pnpm db:studio` | Prisma Studio |
| `pnpm -r typecheck` / `pnpm -r lint` / `pnpm -r test` / `pnpm build` | quality gates |

---

## Environment variables

All control-plane config is parsed and validated once at boot by
`packages/config/src/index.ts` (zod). **This table is the authoritative
reference.** Booleans/CSVs are parsed leniently; the app fails fast with a
readable error if a required var is missing or malformed.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `PORT` | no | `4000` | Railway injects this automatically |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `REDIS_URL` | **yes** | — | Redis connection string (queues + pub/sub) |
| `SESSION_SECRET` | **yes** | — | ≥16 chars; must not start with `change-me` in prod |
| `SESSION_COOKIE_DOMAIN` | no | — | Set for cross-subdomain auth in prod |
| `SECRETS_ENCRYPTION_KEY` | **yes** | — | **64 hex chars (32 bytes)**; AES-256-GCM key. Must be non-zero in prod |
| `GITHUB_CLIENT_ID` | no | — | GitHub OAuth app (login + repo access) |
| `GITHUB_CLIENT_SECRET` | no | — | GitHub OAuth app |
| `GITHUB_WEBHOOK_SECRET` | no | — | HMAC secret for push/PR webhooks |
| `PUBLIC_API_URL` | no | `http://localhost:4000` | Public URL of the API (OAuth redirects, links) |
| `PUBLIC_WEB_URL` | no | `http://localhost:3000` | Public URL of the dashboard; always CORS-allowed |
| `BASE_PREVIEW_DOMAIN` | no | `preview.noderail.local` | Base for generated app/preview domains |
| `ADMIN_EMAILS` | no | — | CSV of platform-admin emails |
| `CORS_ORIGINS` | no | — | CSV of extra allowed origins |
| `RATE_LIMIT_MAX` | no | `300` | Requests per window (per user/IP) |
| `RATE_LIMIT_WINDOW` | no | `1 minute` | Rate-limit window |
| `LOG_RETENTION_DAYS` | no | `14` | Default log retention (plan can override) |
| `LOG_LEVEL` | no | `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace` |

**Web app** additionally needs `NEXT_PUBLIC_API_URL` — a **build-time** public
variable inlined into the client bundle by Next.js. It must point at the public
API URL (`http://localhost:4000` locally).

> Compose-only vars (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`/ports)
> live in `infra/.env` and are used to build the container `DATABASE_URL` — they
> are not read by the apps directly.

---

## Deploying to Railway

NodeRail's control plane maps cleanly onto Railway. Create **one project** with
five services: **Postgres**, **Redis**, **api**, **worker**, and **web**.

### 1. Add the datastores

In your Railway project, click **New → Database → Add PostgreSQL**, then again for
**Redis**. Railway exposes reference variables `${{Postgres.DATABASE_URL}}` and
`${{Redis.REDIS_URL}}` you'll wire into the app services below. **Add Postgres and
Redis to the same project** so they share the private network.

### 2. Service layout

| Service | Root directory | Builder | Config file | Start command |
| --- | --- | --- | --- | --- |
| **api** | repo root | Dockerfile | `apps/api/railway.toml` | `node dist/index.js` |
| **worker** | repo root | Dockerfile | `apps/worker/railway.toml` | `node dist/index.js` |
| **web** | repo root | Dockerfile | `infra/railway/web.railway.toml`¹ | `node apps/web/server.js` |

> **Set each service's Root Directory to the _repo root_**, not the app subfolder.
> This is a pnpm monorepo: the Docker build context needs the root lockfile and
> every workspace manifest. The per-service `railway.toml` points `dockerfilePath`
> at the right Dockerfile (`apps/api/Dockerfile`, `apps/worker/Dockerfile`,
> `infra/docker/web.Dockerfile`).
>
> ¹ The web app is maintained by another team, so its Railway config ships as a
> **template** at `infra/railway/web.railway.toml`. Copy it to
> `apps/web/railway.toml`, or set the same builder/start command/`NEXT_PUBLIC_API_URL`
> build arg in the Railway UI.

### 3. Environment variables per service

**api** and **worker** (shared):

```
DATABASE_URL           = ${{Postgres.DATABASE_URL}}
REDIS_URL              = ${{Redis.REDIS_URL}}
SESSION_SECRET         = <openssl rand -hex 32>
SECRETS_ENCRYPTION_KEY = <openssl rand -hex 32>   # 64 hex chars
NODE_ENV               = production
```

**api** additionally:

```
PUBLIC_API_URL       = https://api.<your-domain>
PUBLIC_WEB_URL       = https://app.<your-domain>
ADMIN_EMAILS         = you@example.com
CORS_ORIGINS         = https://app.<your-domain>
GITHUB_CLIENT_ID     = <optional, for GitHub login/repos>
GITHUB_CLIENT_SECRET = <optional>
GITHUB_WEBHOOK_SECRET= <optional, for push/PR deploys>
BASE_PREVIEW_DOMAIN  = preview.<your-domain>
```

**web**:

```
NEXT_PUBLIC_API_URL  = https://api.<your-domain>   # BUILD-TIME arg (see template)
```

`PORT` is injected by Railway automatically — do not set it manually.

### 4. Migrations

The **api** service runs migrations as a **pre-deploy step** before the new
version receives traffic:

```
preDeployCommand = "pnpm --filter @noderail/db migrate:deploy"
```

This is already set in `apps/api/railway.toml`. It runs inside the freshly built
api image, which ships the Prisma CLI, schema, and migrations. **Do not** also run
migrations on the worker — a single owner avoids races. (Equivalently, Railway's
_Settings → Deploy → Pre-deploy Command_ can host the same command.)

### 5. Healthchecks

- **api**: `healthcheckPath = /health` (Fastify liveness).
- **worker**: no external HTTP; Railway's restart policy handles liveness.
- **web**: `healthcheckPath = /`.

### Production deploy checklist

- [ ] Postgres + Redis added to the **same** Railway project
- [ ] `SESSION_SECRET` and `SECRETS_ENCRYPTION_KEY` are real random values (not the
      examples), 64 hex chars for the encryption key
- [ ] `NODE_ENV=production` on api + worker
- [ ] `PUBLIC_API_URL` / `PUBLIC_WEB_URL` / `CORS_ORIGINS` match your real domains
- [ ] `ADMIN_EMAILS` set to your admin identities
- [ ] GitHub OAuth app + webhook secret configured (if using git deploys)
- [ ] `NEXT_PUBLIC_API_URL` build arg set for **web**
- [ ] api pre-deploy migration succeeds on first deploy
- [ ] `/ready` returns `200` (db + redis reachable)

Full detail (self-host, scaling, backups) lives in
**[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)** and
**[docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md)**.

---

## Your first deployment

Once the control plane is running:

1. **Sign in.** Open the dashboard, log in with GitHub (or use dev-login locally).
   A personal **workspace** is created; you're the `owner`.
2. **Connect your first node.** In the workspace, mint a **join token**
   (`POST /v1/workspaces/:id/nodes/join-token` or via the CLI). The response
   includes a one-line installer:
   ```bash
   curl -fsSL https://app.<your-domain>/install.sh \
     | NODERAIL_API_URL=https://api.<your-domain> NODERAIL_JOIN_TOKEN=nrj_... sh
   ```
   The agent registers, receives a hashed agent token + an HMAC command key, and
   starts sending heartbeats. Join tokens expire in **15 minutes** and are
   single-use.
3. **Connect GitHub.** Authorize the GitHub OAuth app, then connect a repository.
   NodeRail installs a webhook (if `GITHUB_WEBHOOK_SECRET` is set) so pushes and
   PRs trigger deploys.
4. **Create an app and deploy.** Point an app at a repo + branch, pick a node, and
   trigger a deploy (`POST /v1/apps/:id/deploy`) or just `git push`. Watch the
   pipeline stream live: checkout → install → test → build → package → deploy →
   healthcheck → finalize. On success the app is `running` and reachable through
   the node's Caddy edge with automatic HTTPS.

---

## Further documentation

| Doc | What's inside |
| --- | --- |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Control vs data plane, agent protocol, deployment state machine, SSE, data model |
| [docs/SECURITY.md](./docs/SECURITY.md) | Threat model, agent capabilities, secret handling, webhook verification, node trust, RBAC |
| [docs/API.md](./docs/API.md) | Full REST reference, agent protocol endpoints, SSE channels, OpenAPI/Swagger |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Railway + self-host guide, migrations, scaling, backups |
| [docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md) | Go-live checklist |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Dev setup, standards, PR workflow |

---

## What's implemented / future hardening

**Implemented today**

- Multi-tenant workspaces with 4-tier RBAC (owner/admin/developer/viewer) + a
  platform-admin surface
- GitHub OAuth login, repo connection, push/PR webhook deploys with signature
  verification
- Node lifecycle: single-use expiring join tokens → registration → heartbeat/
  telemetry → signed typed command polling → result/log reporting
- Full deployment pipeline (8 stages) with live build + runtime log streaming over
  SSE (Redis pub/sub fan-out)
- Preview environments and domains for pull requests
- Secrets encrypted at rest (AES-256-GCM), redacted in logs, injected only over
  TLS in signed commands
- Rollbacks from immutable spec snapshots, health checks, domain verification with
  automatic HTTPS via Caddy
- Rate limiting, audit logging, log retention, Prometheus `/metrics`, OpenAPI 3.1
  spec + Swagger UI

**Future hardening** (see [docs/SECURITY.md](./docs/SECURITY.md) for the full list)

- mTLS between agent and control plane (currently Bearer + HMAC over TLS)
- Firecracker/gVisor-sandboxed build execution
- Signed, reproducible agent binary releases
- SSO / SAML / SCIM for enterprise workspaces
- SOC2-style tamper-evident audit log export
- Slimmer runtime container images (`pnpm deploy --prod`)

---

## License

[Apache License 2.0](./LICENSE) © 2026 NodeRail contributors.
