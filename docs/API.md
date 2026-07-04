# NodeRail API Reference

The NodeRail control-plane exposes a REST API (Fastify). This document covers
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
| **Session cookie** | `Cookie: nr_session=<token>` | Issued by GitHub OAuth / dev-login. 30-day TTL. `httpOnly`, `sameSite=lax`, `secure` in prod. |
| **Personal API token** | `Authorization: Bearer nr_<token>` | Created per user/workspace; supports expiry + revocation. |
| **Agent token** | `Authorization: Bearer nra_<token>` | Per-node; only accepted on `/v1/agent/*`. |

Auth resolution is non-rejecting: `req.user` is populated if a valid session or
API token is present, and individual routes enforce authorization with
`requireUser` / `requirePermission(<permission>)`. See
[SECURITY.md](./SECURITY.md#6-rbac--roles--permissions) for the permission matrix.

### Auth endpoints (`/v1/auth`)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/v1/auth/github` | none | Begin GitHub OAuth (sets `nr_oauth_state` cookie). |
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
| GET | `/version` | `{ service: 'noderail-api', protocolVersion: 1 }`. |
| GET | `/metrics` | Prometheus text exposition (`text/plain; version=0.0.4`). Gauges: `noderail_process_resident_memory_bytes`, `noderail_process_uptime_seconds`, `noderail_nodes_total`, `noderail_nodes_online`, `noderail_apps_running`, `noderail_commands_queued`. |

---

## Agent protocol (`/v1/agent`)

For node agents only. Full semantics in
[ARCHITECTURE.md §2](./ARCHITECTURE.md#2-node-command-protocol). Auth is the
one-time join token for `register`, then the Bearer agent token (`nra_…`).

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
all API instances via a single Redis pub/sub channel (`noderail:events`).

---

## OpenAPI / Swagger

- **`GET /openapi.json`** — OpenAPI **3.1.0**. `info.title = "NodeRail API"`,
  `version = "0.1.0"`, `servers: [{ url: '/v1' }]`. Security schemes:
  `sessionCookie` (apiKey cookie `nr_session`) and `bearerToken` (http bearer,
  personal `nr_…` token). Tags are derived from the second path segment; the spec
  is generated from the live route table.
- **`GET /docs`** — Swagger UI pointed at `/openapi.json`.
