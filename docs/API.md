# YourStack API Reference

The YourStack control-plane exposes a REST API (Fastify). This document covers
authentication, conventions, every resource's endpoints, the agent protocol, and
the realtime SSE channel.

- **Base path:** all resource routes are versioned under **`/v1`**
  (`API_VERSION = 'v1'`). Health/metrics are unversioned.
- **Interactive docs:** the API serves an **OpenAPI 3.1** spec at
  **`GET /openapi.json`** and **Swagger UI** at **`GET /docs`**. The spec is built
  from the live route table (via Fastify's `onRoute` hook), so it always reflects
  the mounted routes.
- **Content type:** `application/json` (raw body is preserved for webhook HMAC).
- **Body limit:** 5 MiB. **Request ids:** `req_<rand>` (logged, returned in errors).

---

## Authentication

Three credential types (all stored server-side only as SHA-256 hashes):

| Credential | How it's sent | Notes |
| --- | --- | --- |
| **Session cookie** | `Cookie: ys_session=<token>` | Issued by GitHub OAuth / dev-login. 30-day TTL. `httpOnly`, `sameSite=lax`, `secure` in prod. |
| **Personal API token** | `Authorization: Bearer ys_<token>` | Created per user/workspace; supports expiry + revocation. |
| **Agent token** | `Authorization: Bearer ysa_<token>` | Per-node; only accepted on `/v1/agent/*`. |

Auth resolution is non-rejecting: `req.user` is populated if a valid session or
API token is present, and individual routes enforce authorization with
`requireUser` / `requirePermission(<permission>)`. See
[SECURITY.md](./SECURITY.md#6-rbac--roles--permissions) for the permission matrix.

### Auth endpoints (`/v1/auth`)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/v1/auth/github` | none | Begin GitHub OAuth (sets `ys_oauth_state` cookie). |
| GET | `/v1/auth/github/callback` | none | OAuth callback; upserts user + encrypted token, creates session, redirects to `<WEB>/dashboard`. Audits `auth.login`. |
| POST | `/v1/auth/dev-login` | none | **Disabled in production.** Body `{ email, name? }`; upserts user (admin if email ∈ `ADMIN_EMAILS`), creates session. |
| GET | `/v1/auth/me` | user | `{ user, workspaces: [{ ...membership, role }] }`. |
| POST | `/v1/auth/logout` | user | Destroys session, clears cookie. Audits `auth.logout`. |

---

## Conventions

- **Errors** use `@fastify/sensible` shapes: `{ statusCode, error, message }`.
  `401` unauthenticated, `403` missing permission, `404` not found, `429` rate
  limited (default `300 / minute`, keyed by user or IP).
- **Pagination**: list endpoints accept `limit` (defaults per resource; `MAX_PAGE_SIZE = 100`
  for paged collections).
- **Soft deletes**: workspaces, projects, apps, and nodes use `deletedAt`; delete
  endpoints return `204`.
- **IDs** are cuids unless noted.

---

## Workspaces (`/v1/workspaces`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/v1/workspaces` | user | Create workspace (plan `dev`; creator becomes `owner`). Audits `workspace.create`. |
| GET | `/v1/workspaces/:id` | member | Workspace detail. |
| PATCH | `/v1/workspaces/:id` | `workspace:update` | Update name/settings. |
| GET | `/v1/workspaces/:id/stats` | `workspace:view` | Counts + `deploymentsToday`. |
| GET | `/v1/workspaces/:id/members` | `member:view` | List members. |
| POST | `/v1/workspaces/:id/members` | `member:invite` | Body `{ email, role: admin\|developer\|viewer }`. |
| PATCH | `/v1/workspaces/:id/members/:memberId` | `member:update_role` | Change role (guards last owner). |
| DELETE | `/v1/workspaces/:id/members/:memberId` | `member:remove` | Remove member (guards last owner). `204`. |

---

## Projects (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/workspaces/:wid/projects` | `project:view` | List projects. |
| POST | `/v1/workspaces/:wid/projects` | `project:create` | Body `createProjectSchema` (`name`, `slug`, `description?`). |
| GET | `/v1/projects/:id` | `project:view` | Project detail. |
| PATCH | `/v1/projects/:id` | `project:update` | Update. |
| DELETE | `/v1/projects/:id` | `project:delete` | Soft-delete. `204`. |

---

## Apps (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/projects/:pid/apps` | `app:view` | List apps. |
| POST | `/v1/projects/:pid/apps` | `app:create` | Body `createAppSchema`; enforces `plan.maxApps`; creates default `production` env. Audits `app.create`. |
| GET | `/v1/apps/:id` | `app:view` | App detail. |
| PATCH | `/v1/apps/:id` | `app:update` | Update runtime spec (build/start command, port, resources, healthcheck, branch, etc.). |
| DELETE | `/v1/apps/:id` | `app:delete` | Best-effort `REMOVE_APP` command, soft-delete. Audits `app.delete`. `204`. |
| POST | `/v1/apps/:id/deploy` | `app:deploy` | Body `deployAppRequestSchema` (`{ ref?, environmentId?, reason? }`). Triggers a deployment. Audits `app.deploy`. |
| POST | `/v1/apps/:id/restart` | `app:control` | Dispatch `RESTART_APP`. |
| POST | `/v1/apps/:id/stop` | `app:control` | Dispatch `STOP_APP` (10s grace); status → `stopped`. |
| POST | `/v1/apps/:id/rollback` | `app:rollback` | Body `{ targetDeploymentId }`. Enqueues rollback. Audits `app.rollback`. |

**App status** (`AppStatus`): `idle | building | deploying | running | failed | stopped`.

---

## Deployments (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/apps/:id/deployments` | `app:view` | Last 50, newest version first. |
| GET | `/v1/deployments/:id` | `app:view` | `{ deployment, pipelineRun \| null }`. |
| GET | `/v1/deployments/:id/logs` | `log:view` | Build logs ordered by `seq` (≤ 2000). |

**Deployment status** (`DeploymentStatus`): `queued | building | deploying |
running | failed | stopped | rolled_back | superseded`. See the
[state machine](./ARCHITECTURE.md#3-deployment-lifecycle-state-machine).

---

## Secrets (`/v1/secrets`)

Values are **never** returned — responses (`toSecretDTO`) expose metadata and
`lastFour` only.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/secrets?projectId\|appId\|environmentId` | `secret:view` | List secrets in scope. |
| POST | `/v1/secrets` | `secret:write` | Body `createSecretSchema`; value encrypted (AES-256-GCM); upsert on unique scope key. Audits `secret.create`. |
| PATCH | `/v1/secrets/:id` | `secret:write` | Update value. Audits `secret.update`. |
| DELETE | `/v1/secrets/:id` | `secret:delete` | Audits `secret.delete`. `204`. |

**Scopes** (`SecretScope`): `project | app | environment`.

---

## Domains (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/apps/:id/domains` | `domain:view` | List domains. |
| POST | `/v1/apps/:id/domains` | `domain:write` | Body `createDomainSchema`. Sets `verificationToken` + `dnsTarget`, enqueues verification. Returns `{ domain, instructions: { recordType: A\|CNAME, name, value, note } }`. Audits `domain.create`. |
| POST | `/v1/domains/:id/verify` | `domain:write` | Re-enqueue verification → `{ ok, status: 'verifying' }`. |
| DELETE | `/v1/domains/:id` | `domain:delete` | Audits `domain.delete`. `204`. |

**Domain status** (`DomainStatus`): `pending | verifying | verified | active | failed`.

---

## Logs (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/apps/:id/logs` | `log:view` | Runtime logs. Query `logQuerySchema`: `severity?`, `search?`, `since?`, `until?`, `limit` (≤ 1000, default 200). |

**Severity** (`LogSeverity`): `debug | info | warn | error`. **Streams**
(`LogStream`): `build | runtime | system`.

---

## Nodes (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/workspaces/:wid/nodes` | `node:view` | List nodes. |
| POST | `/v1/workspaces/:wid/nodes/join-token` | `node:join` | Mint a join token (enforces `plan.maxNodes`). Returns `{ joinToken, expiresAt, apiUrl, installCommand }`. TTL 15 min, single use. Audits `node.join_token_create`. |
| GET | `/v1/nodes/:id` | `node:view` | Node detail + telemetry. |
| GET | `/v1/nodes/:id/apps` | `node:view` | Apps assigned to the node. |
| GET | `/v1/nodes/:id/heartbeats` | `node:view` | Last 60 heartbeats. |
| PATCH | `/v1/nodes/:id` | `node:update` | Body `{ name?, region? }`. |
| POST | `/v1/nodes/:id/labels` | `node:update` | Upsert `{ key, value }`. |
| DELETE | `/v1/nodes/:id/labels/:key` | `node:update` | `204`. |
| POST | `/v1/nodes/:id/drain` | `node:drain` | Status → `draining`. Audits `node.drain`. |
| DELETE | `/v1/nodes/:id` | `node:remove` | Soft-delete, **revokes agent** (`agentTokenHash = null`), detaches apps. Audits `node.remove`. `204`. |

**Node status** (`NodeStatus`): `online | degraded | offline | draining`.

---

## Repositories (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/github/repos` | user | List the user's GitHub repos (decrypts stored OAuth token). |
| GET | `/v1/workspaces/:wid/repos` | `repo:view` | Connected repositories. |
| POST | `/v1/workspaces/:wid/repos` | `repo:connect` | Body `connectRepoSchema`; upserts `GitRepository`, optionally installs a GitHub webhook. Audits `repo.connect`. |

---

## API tokens (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/workspaces/:wid/tokens` | `token:view` | List non-revoked tokens. |
| POST | `/v1/workspaces/:wid/tokens` | `token:create` | Body `{ name, expiresInDays? (≤365) }`. Returns `{ token, plaintext }` — plaintext shown **once**. Audits `token.create`. |
| DELETE | `/v1/workspaces/:wid/tokens/:id` | `token:revoke` | Sets `revokedAt`. Audits `token.revoke`. `204`. |

---

## Audit (`/v1`)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/v1/workspaces/:wid/audit` | `audit:view` | Audit log. Query `limit` (≤ 500), `action?`. |

---

## Admin (`/v1/admin`)

All guarded by `requirePlatformAdmin` (identity ∈ `ADMIN_EMAILS`).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/v1/admin/stats` | Cross-tenant platform stats. |
| GET | `/v1/admin/workspaces` | All workspaces. |
| GET | `/v1/admin/users` | All users. |
| GET | `/v1/admin/nodes` | All nodes. |
| GET | `/v1/admin/audit` | Cross-tenant audit. |
| POST | `/v1/admin/workspaces/:id/suspend` | Body `{ suspend? }` (default true). Audits `admin.workspace_suspend`. |
| POST | `/v1/admin/nodes/:id/disable` | Body `{ disable? }` (default true). Audits `admin.node_disable`. |

---

## Health & metrics (unversioned)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Liveness: `{ status: 'ok', service: 'api', time }`. Used by Railway/Docker healthchecks. |
| GET | `/ready` | Readiness: checks Postgres (`SELECT 1`) + Redis (`PING`). `200 { status:'ready', checks }` or `503 { status:'degraded', checks }`. |
| GET | `/version` | `{ service: 'yourstack-api', protocolVersion: 1 }`. |
| GET | `/metrics` | Prometheus text exposition (`text/plain; version=0.0.4`). Gauges: `yourstack_process_resident_memory_bytes`, `yourstack_process_uptime_seconds`, `yourstack_nodes_total`, `yourstack_nodes_online`, `yourstack_apps_running`, `yourstack_commands_queued`. |

---

## Agent protocol (`/v1/agent`)

For node agents only. Full semantics in
[ARCHITECTURE.md §2](./ARCHITECTURE.md#2-node-command-protocol). Auth is the
one-time join token for `register`, then the Bearer agent token (`ysa_…`).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/v1/agent/register` | join token | Body `nodeRegisterSchema` (`{ joinToken, name, telemetry }`). Returns `{ nodeId, agentToken, commandVerifyKey, heartbeatIntervalMs }`. Audits `node.register`. |
| POST | `/v1/agent/heartbeat` | agent token | Body `{ telemetry }`. Returns `{ ok, desiredStatus: 'online'\|'draining', hasPendingCommands, serverTime }`. |
| GET | `/v1/agent/commands` | agent token | Long-poll; atomically claims ≤10 queued commands (→ `accepted`). Returns `{ commands: NodeCommand[] }` (signed envelopes). |
| POST | `/v1/agent/commands/:id/result` | agent token | Body `commandResultSchema` (`{ status, output, error? }`). Advances the deployment state machine; publishes `command.update`. |
| POST | `/v1/agent/logs` | agent token | Body `logBatchSchema` (≤1000 events). Persists build/runtime logs; publishes `log.build`/`log.runtime`. Returns `{ ok, ingested }`. |

### Command envelope (`nodeCommandSchema`)

```json
{
  "id": "cmd_...",
  "nodeId": "node_...",
  "payload": { "type": "DEPLOY_APP", "spec": { "...": "DeployAppSpec" } },
  "timeoutMs": 900000,
  "issuedAt": "2026-07-04T12:00:00.000Z",
  "signature": "<hmac_sha256_hex over canonicalJson({id,nodeId,payload,timeoutMs,issuedAt})>"
}
```

`CommandType` ∈ `DEPLOY_APP | STOP_APP | RESTART_APP | REMOVE_APP | STREAM_LOGS |
HEALTH_CHECK | CONFIGURE_DOMAIN | ROLLBACK_DEPLOYMENT` (no free-form command).

### Command result (`commandResultSchema`)

```json
{
  "commandId": "cmd_...",
  "status": "succeeded",              // accepted|running|succeeded|failed|timed_out
  "output": {
    "message": "container started",
    "containerId": "…", "imageDigest": "sha256:…",
    "hostPort": 34011, "healthy": true, "exitCode": 0, "durationMs": 8123
  },
  "error": null
}
```

---

## Webhooks (`/v1/webhooks`)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/v1/webhooks/github` | GitHub push/PR webhook. Requires `GITHUB_WEBHOOK_SECRET`. Verifies `x-hub-signature-256` HMAC over the **raw body**; `401` on mismatch. `ping` → `{ ok, pong: true }`. Unknown repo → ignored. Deduped by `x-github-delivery`. Persists + enqueues a `WebhookJob`. Returns **`202`** `{ ok, webhookId }`. |

Push events deploy apps bound to the pushed branch; pull-request events
(`opened`/`synchronize`/`reopened`) create/refresh a **preview** deployment and a
preview domain `<app>-pr<n>.<BASE_PREVIEW_DOMAIN>`.

---

## Realtime — Server-Sent Events (`/v1/events`)

`GET /v1/events?channel=<kind:id>` streams `text/event-stream`. The channel is
authorized (below) before streaming; an `event: open` is sent first, then each
event as `event: <type>\ndata: <json>\n\n`, with a keep-alive comment every 20s.

| Channel | Format | Required permission |
| --- | --- | --- |
| Workspace | `workspace:<id>` | `workspace:view` |
| Node | `node:<id>` | `node:view` |
| App | `app:<id>` | `log:view` |
| Deployment | `deployment:<id>` | `log:view` |
| Pipeline | `pipeline:<runId>` | `pipeline:view` |

**Event types**: `node.registered`, `node.heartbeat`, `node.status`,
`log.runtime`, `log.build`, `deployment.created`, `deployment.status`,
`domain.status`, `command.queued`, `command.update`. Events are fanned out across
all API instances via a single Redis pub/sub channel (`yourstack:events`).

---

## OpenAPI / Swagger

- **`GET /openapi.json`** — OpenAPI **3.1.0**. `info.title = "YourStack API"`,
  `version = "0.1.0"`, `servers: [{ url: '/v1' }]`. Security schemes:
  `sessionCookie` (apiKey cookie `ys_session`) and `bearerToken` (http bearer,
  personal `ys_…` token). Tags are derived from the second path segment; the spec
  is generated from the live route table.
- **`GET /docs`** — Swagger UI pointed at `/openapi.json`.

---

## Managed resources (v2)

All routes require the session cookie or a Bearer token and are gated by RBAC.
Provisioning is asynchronous: the API creates the record, enqueues a job, the
worker dispatches a **signed** node command, the agent executes it via Docker,
and the API finalizes state on report-back (streamed over SSE).

### Databases (`DATA_*` permissions)
| Method | Path | Notes |
|---|---|---|
| GET | `/v1/projects/:pid/databases` | list |
| POST | `/v1/projects/:pid/databases` | `{name,engine,version,storageMb,cpu,memoryMb,region?,nodeId?}` |
| GET | `/v1/databases/:id` | detail |
| GET | `/v1/databases/:id/credentials` | reveal `{username,password,host,port,connectionString}` (audited) |
| POST | `/v1/databases/:id/{stop\|start\|backup}` | lifecycle |
| DELETE | `/v1/databases/:id` | remove |

### Object storage (`STORAGE_*`)
`GET/POST /v1/projects/:pid/buckets`, `GET /v1/buckets/:id`,
`GET /v1/buckets/:id/credentials` (→ `{endpoint,region,accessKey,secretKey}`),
`DELETE /v1/buckets/:id`.

### Serverless functions (`FUNCTION_*`)
`GET/POST /v1/projects/:pid/functions`, `GET /v1/functions/:id`,
`POST /v1/functions/:id/invoke` (`{payload}` → `{commandId}`),
`GET /v1/functions/:id/invocations`, `DELETE /v1/functions/:id`.

### CI runner pools (`RUNNER_*`)
`GET/POST /v1/workspaces/:wid/runner-pools`, `GET /v1/runner-pools/:id`,
`GET /v1/runner-pools/:id/runners`, `DELETE /v1/runner-pools/:id`.

### Autoscaling (`SCALING_*`)
`GET /v1/apps/:id/scaling`, `PUT /v1/apps/:id/scaling`
(`{enabled,minReplicas,maxReplicas,metric,targetValue,cooldownSeconds}`).

### Regions
`GET /v1/regions` (catalog + node counts), `POST /v1/admin/regions` (platform admin).

### Metrics (`METRICS_VIEW`)
- `POST /v1/agent/metrics` — **agent-authed** ingest of a `MetricBatch`
  (`{nodeId?, points:[{scope,targetId,kind,value,instance?,timestamp}]}`),
  upserted into `stepSeconds` buckets.
- `GET /v1/metrics?scope=&targetId=&kinds=&windowSeconds=&stepSeconds=` →
  `{series:[{kind,points:[{t,v}]}]}`.
- **SSE** live stream on channel `metrics:<scope>:<targetId>` (event `metric`).

The 12 new signed node-command types powering these:
`PROVISION_DATABASE`, `STOP_DATABASE`, `REMOVE_DATABASE`, `BACKUP_DATABASE`,
`PROVISION_STORAGE`, `REMOVE_STORAGE`, `DEPLOY_FUNCTION`, `INVOKE_FUNCTION`,
`REMOVE_FUNCTION`, `REGISTER_RUNNER`, `DEREGISTER_RUNNER`, `SCALE_APP`.

---

## GitHub App, Marketplace & Cron (v3)

### GitHub App (install → autodeploy)
`GET /v1/github/app/install-url?workspaceId=` → `{url}` (open to install the app),
`GET /v1/github/app/callback` (redirect target), `GET /v1/workspaces/:wid/github/installations`,
`GET /v1/github/installations/:id/repos`, `DELETE /v1/github/installations/:id`,
`POST /v1/webhooks/github-app` (app webhook: installation sync + push → autodeploy + check runs).
Requires `GITHUB_APP_ID/SLUG/CLIENT_ID/CLIENT_SECRET/PRIVATE_KEY/WEBHOOK_SECRET`.

### Template marketplace
`GET /v1/templates?category=&search=`, `GET /v1/templates/:slug`,
`POST /v1/templates/deploy` (`{templateSlug,projectId,name?,region?,variables}`) →
translates a template into a `database` or `app` (arbitrary container image) and provisions it.

### Cron jobs
`GET/POST /v1/projects/:pid/cron`, `GET/PATCH/DELETE /v1/cron/:id`,
`POST /v1/cron/:id/run` (trigger now), `GET /v1/cron/:id/runs`. The worker owns the
repeatable schedule; each fire dispatches a signed `RUN_JOB` node command that runs the
container to completion and reports exit code + duration back.

## MCP server (AI agents → YourStack)

`apps/mcp` is a Model Context Protocol server (stdio) exposing 27 tools over the REST
API, authenticated with a personal `ys_…` token via `YOURSTACK_TOKEN` (+ `YOURSTACK_API_URL`).
Point Claude Desktop / Cursor / Claude Code at `yourstack-mcp` to let an agent deploy and
operate everything the token's user can. See `apps/mcp/README.md`.

---

## Organizations, Teams, Firewalls, Load Balancers, Blueprint (v4)

### Organizations & teams
`GET/POST /v1/organizations`, `GET /v1/organizations/:id`, `GET /v1/organizations/:id/workspaces`,
`GET/POST /v1/organizations/:id/members`, `PATCH/DELETE /v1/organizations/:id/members/:mid`,
`GET/POST /v1/organizations/:id/teams`, `GET/DELETE /v1/teams/:id`,
`GET/POST /v1/teams/:id/members`, `DELETE /v1/teams/:id/members/:uid`,
`POST /v1/teams/:id/grants` (`{workspaceId,role}`), `DELETE /v1/teams/:id/grants/:workspaceId`.
`POST /v1/workspaces` accepts optional `organizationId` (else a personal org is created).
**RBAC:** effective workspace role = max(platform-admin, org owner/admin, direct WorkspaceMember, team grant).

### Firewalls (nftables) & load balancers (Caddy)
`GET/POST /v1/workspaces/:wid/firewalls`, `GET/PATCH/DELETE /v1/firewalls/:id`, `POST /v1/firewalls/:id/apply`.
`GET/POST /v1/projects/:pid/load-balancers`, `GET /v1/load-balancers/:id`, `POST /v1/load-balancers/:id/reconcile`, `DELETE /v1/load-balancers/:id`.

### Node administration
`POST /v1/nodes/:id/actions` (`{action:'reboot'|'docker_prune'|'agent_update',version?}`),
`GET /v1/nodes/:id/commands`. New signed commands: CONFIGURE_FIREWALL, PROVISION_LB, REMOVE_LB, NODE_REBOOT, DOCKER_PRUNE, AGENT_UPDATE, RUN_JOB.

### Blueprint (`yourstack.yaml`)
`POST /v1/blueprint/apply` (`{workspaceId,blueprint,dryRun}` → `{plan,applied?}`),
`GET /v1/projects/:pid/blueprint` (export). Also `yst apply` and the visual builder.

## Deploy from GitHub to Railway
1. Connect this GitHub repo in Railway. Add **Postgres** and **Redis** services to the project.
2. Create three services — **api**, **worker**, **web** — each with **Root Directory = repo root** and the config-as-code file: `apps/api/railway.toml`, `apps/worker/railway.toml`, and `infra/railway/web.railway.toml` (Dockerfiles: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `infra/docker/web.Dockerfile`).
3. Set env: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, plus `SESSION_SECRET`, `SECRETS_ENCRYPTION_KEY`, `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, `NEXT_PUBLIC_API_URL`, `ADMIN_EMAILS`. The API runs `prisma migrate deploy` on release.
The control plane (api/worker/web + Postgres + Redis) is fully hosted by Railway; your **nodes** run the agent, and the **MCP** runs client-side via `yst mcp`.
