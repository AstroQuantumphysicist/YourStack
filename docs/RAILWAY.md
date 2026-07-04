# Deploying YourStack to Railway

YourStack's control plane is **three services** — `api`, `worker`, `web` — plus
**Postgres** and **Redis**. (Your servers run the agent; the MCP runs client-side
via `yst mcp`. Neither is hosted on Railway.)

Because this is a pnpm monorepo, each service builds from a **Dockerfile with the
repo root as build context** and is selected by a per-service config file.

## 1. Create the project

1. **New Project → Deploy from GitHub repo →** select `AstroQuantumphysicist/YourStack`.
2. **Add the databases FIRST — this is required.** New → Database → **Add PostgreSQL**,
   then New → Database → **Add Redis**. The control plane cannot start (and the
   pre-deploy migration cannot run) without them.

> ### Troubleshooting: `P1012 … DATABASE_URL resolved to an empty string`
> This means no Postgres exists yet (or the variable isn't referenced). Add a
> Postgres service, then on **api** and **worker** set
> `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `REDIS_URL=${{Redis.REDIS_URL}}`
> (use the **Add Reference** button so the service name is correct), and redeploy.

## 2. Configure the three services

The repo ships a root `railway.json` that makes the **first / default service the
API**, so it deploys with no extra config. For the other two, add a service and set
its config file:

| Service | How to configure | Health |
|---|---|---|
| **api** | Uses root `railway.json` automatically (Dockerfile `apps/api/Dockerfile`). | `/health` |
| **worker** | New Service → same repo → **Settings → Config-as-code Path** = `apps/worker/railway.toml`. | `/health` |
| **web** | New Service → same repo → **Config-as-code Path** = `infra/railway/web.railway.toml`. | `/` |

Leave every service's **Root Directory = `/`** (repo root) — the Dockerfiles need
the workspace lockfile + all packages in the build context.

> Alternatively, per service set **Settings → Build → Builder = Dockerfile** and
> **Dockerfile Path** to `apps/api/Dockerfile`, `apps/worker/Dockerfile`, or
> `infra/docker/web.Dockerfile` — that also bypasses Railpack.

## 3. Environment variables

On **api** and **worker**:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
SESSION_SECRET=<openssl rand -hex 32>
SECRETS_ENCRYPTION_KEY=<openssl rand -hex 32>
PUBLIC_API_URL=https://<your-api-domain>
PUBLIC_WEB_URL=https://<your-web-domain>
ADMIN_EMAILS=you@example.com
# optional: GITHUB_CLIENT_ID/SECRET, GITHUB_WEBHOOK_SECRET, GITHUB_APP_*, RATE_LIMIT_*, LOG_LEVEL
```

On **web** (build-time):

```
NEXT_PUBLIC_API_URL=https://<your-api-domain>
```

## 4. Migrations

The **api** service runs `pnpm --filter @yourstack/db migrate:deploy` as its
**pre-deploy command** (already in `railway.json`), so the schema is applied on
every release from the exact serving image. The worker never migrates.

## 5. Go

Expose a public domain on **web** (and **api**). Sign in, connect your first node,
and deploy. See the root `README.md` for the full checklist.
