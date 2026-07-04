# YourStack Architecture

YourStack is split into a **control plane** (managed, multi-tenant) and a **data
plane** (user-owned servers). This document explains the components, the node
command protocol, the deployment lifecycle, the CI/CD pipeline stages, the
realtime layer, and the data model.

- Protocol version: **`AGENT_PROTOCOL_VERSION = 1`**
- API version prefix: **`/v1`** (`API_VERSION = 'v1'`)

---

## 1. Control plane vs data plane

### Control plane

Runs wherever you host it (Railway, Fly, a Kubernetes cluster, etc.). Stateless
except for its datastores.

| Component | Package | Responsibility |
| --- | --- | --- |
| **API** | `apps/api` (Fastify, ESM) | REST + OAuth + SSE; terminates all user & agent traffic; signs commands; verifies webhooks; enqueues jobs |
| **Worker** | `apps/worker` (BullMQ) | Runs the deploy pipeline, webhook processing, health checks, domain verification, scheduled maintenance |
| **Postgres** | `packages/db` (Prisma) | Single source of truth |
| **Redis** | — | BullMQ queues **and** pub/sub bus for SSE fan-out |

The API and worker are TypeScript, bundled by **tsup** into a single ESM
`dist/index.js`. Internal `@yourstack/*` packages are inlined into the bundle;
only `@prisma/client` is kept external (its native engine can't be bundled). The
Prisma client is generated with `pnpm --filter @yourstack/db generate` and needs
`openssl` at runtime.

### Data plane

Each user runs the **agent** (`apps/agent`, Rust) on a server they own. The agent:

- registers the node with a one-time join token,
- reports telemetry + heartbeats,
- polls for **signed, typed** commands,
- executes them against the local Docker daemon (via `bollard`),
- streams build/runtime logs back,
- manages a **Caddy** edge for routing + automatic HTTPS.

The agent never receives long-lived platform credentials beyond its own hashed
agent token and a per-node HMAC command-verification key.

---

## 2. Node command protocol

All agent traffic is mounted under `/v1/agent/*`. The lifecycle:

```
register ──▶ heartbeat ──▶ poll commands ──▶ execute ──▶ report result ──▶ stream logs
   │             │              │                             │
 join token   telemetry     long-poll                    typed result
 (once)       (every 15s)   (signed envelopes)           (status + output)
```

### 2.1 Register — `POST /v1/agent/register`

- **Auth:** the one-time **join token** (`ysj_…`), not an agent token.
- Body (`nodeRegisterSchema`): `{ joinToken, name, telemetry }` where telemetry
  includes `agentVersion, protocolVersion, os, arch, cpuCores, memoryTotalMb,
  diskTotalMb, dockerVersion?, publicIp?`.
- The API validates the join token (SHA-256 hash lookup, unused, unexpired),
  mints an **agent token** (`ysa_…`, 40 bytes) and a **command key** (32 random
  bytes, hex), creates the `Node` (status `online`), marks the join token used,
  and audits `node.register`.
- **Response:** `{ nodeId, agentToken, commandVerifyKey, heartbeatIntervalMs }`.
  The plaintext agent token is shown **once**; only its SHA-256 hash is stored
  (`Node.agentTokenHash`). The command key is stored as `Node.commandKey`.

### 2.2 Heartbeat — `POST /v1/agent/heartbeat`

- **Auth:** Bearer agent token.
- Interval: **`HEARTBEAT_INTERVAL_MS = 15_000`** (15s).
- Updates node status → `online`, records telemetry, writes a `NodeHeartbeat`
  row, publishes `node.heartbeat`.
- **Response:** `{ ok, desiredStatus: 'online'|'draining', hasPendingCommands,
  serverTime }`. `desiredStatus: 'draining'` tells the agent to stop accepting new
  work.

Liveness thresholds (from `packages/shared/constants.ts`), enforced by the
worker's `node_liveness` maintenance job:

| State | Condition |
| --- | --- |
| `online` | heartbeat within 45s |
| `degraded` | no heartbeat for > `NODE_DEGRADED_AFTER_MS = 45_000` |
| `offline` | no heartbeat for > `NODE_OFFLINE_AFTER_MS = 90_000` |
| `draining` | operator-initiated; not auto-overwritten |

### 2.3 Poll commands — `GET /v1/agent/commands`

- **Auth:** Bearer agent token.
- Long-poll: atomically claims up to 10 `queued` commands (→ `accepted`, ordered
  by `issuedAt`). If none are queued it waits ~1s and retries once, then returns
  an empty list. (Client-side poll budget: `COMMAND_POLL_TIMEOUT_MS = 25_000`.)
- **Response:** `{ commands: NodeCommand[] }`, each a **signed envelope**.

### 2.4 Command signing (HMAC-SHA256)

Commands are created in Postgres (`NodeCommand`, `status='queued'`) and signed
with the node's `commandKey`:

```
signature = HMAC_SHA256(
  key = hex-decode(node.commandKey),
  msg = canonicalJson({ id, nodeId, payload, timeoutMs, issuedAt })
)
```

`canonicalJson` (in `packages/shared/canonical.ts`) is `JSON.stringify` with keys
**recursively sorted** and no whitespace — a deterministic byte sequence the Rust
agent reproduces exactly to verify the signature before executing anything. The
envelope shape is `nodeCommandSchema`: `{ id, nodeId, payload, timeoutMs,
issuedAt, signature }`.

### 2.5 Typed command payloads

`commandPayloadSchema` is a **discriminated union on `type`** over exactly eight
`CommandType` values — there is intentionally **no free-form/shell command**:

| CommandType | Purpose |
| --- | --- |
| `DEPLOY_APP` | Build/pull image and run the app container (`DeployAppSpec`) |
| `STOP_APP` | Stop the app container |
| `RESTART_APP` | Restart the app container |
| `REMOVE_APP` | Remove the app container |
| `STREAM_LOGS` | Attach and stream container logs |
| `HEALTH_CHECK` | Probe the app health endpoint |
| `CONFIGURE_DOMAIN` | Configure the Caddy route + auto-HTTPS |
| `ROLLBACK_DEPLOYMENT` | Redeploy a prior spec snapshot |

`DeployAppSpec` carries `appId, deploymentId, containerName, imageTag, source`
(a union of `image` | `git` | `buildpack`), `env` (a record transmitted only over
TLS), `ports`, `resources` (cpu default 0.5, memoryMb default 512), optional
`healthcheck` and `domain`, `strategy` (`basic_replace` | `rolling`), and labels.

### 2.6 Report result — `POST /v1/agent/commands/:id/result`

Body (`commandResultSchema`): `{ status, output, error? }` where `status ∈
accepted|running|succeeded|failed|timed_out` and `output` may include
`{ message, containerId, imageDigest, hostPort, healthy, exitCode, durationMs }`.
The API applies it through the deployment state machine (§3) and publishes
`command.update`.

### 2.7 Stream logs — `POST /v1/agent/logs`

Body (`logBatchSchema`): up to 1000 events. `runtime`/`system` events become
`RuntimeLog` rows and publish `log.runtime`; `build` events (with a
`deploymentId`) become `DeploymentLog` rows (monotonic `seq`) and publish
`log.build`. Messages are truncated to 8000 chars. Secret values are redacted
before persistence (see [SECURITY.md](./SECURITY.md)).

---

## 3. Deployment lifecycle state machine

`DeploymentStatus`: `queued → building → deploying → running`, with terminal
branches `failed`, `stopped`, `rolled_back`, `superseded`
(`TERMINAL_DEPLOYMENT_STATUSES = [running, failed, stopped, rolled_back,
superseded]`).

```
              enqueue (createDeployment)
                     │  App.status = building
                     ▼
                 ┌─────────┐
                 │ queued  │
                 └────┬────┘
     worker deploy    │
     processor picks  ▼
                 ┌──────────┐   control-plane stages:
                 │ building │   checkout · install · test · build · package
                 └────┬─────┘
     dispatch signed  │  App.status = building
     DEPLOY_APP cmd   ▼
                 ┌───────────┐  agent runs container; safety-net healthcheck
                 │ deploying │  job enqueued (delay 5m)
                 └────┬──────┘
   node reports back  │
   applyCommandResult ▼
        healthy? ─────┴───────── not healthy / failed / timed_out
             │                              │
             ▼                              ▼
        ┌─────────┐                    ┌────────┐
        │ running │                    │ failed │
        └────┬────┘                    └────────┘
             │  supersede prior running deployment (→ superseded)
             │  App.status = running; App.currentDeploymentId set
             ▼
     (later) stop → stopped ; rollback → new deployment (rolled_back on target)
```

Key mechanics:

- **Enqueue** (`createDeployment`): computes `version = last + 1`, creates the
  `Deployment` (`queued`), sets `App.status = building`, increments the daily
  `deployments` `UsageRecord`, enqueues a `DeployJob` on `yourstack.deploy`
  (`jobId = deploymentId`), publishes `deployment.created`. Returns null if the
  app has no node assigned.
- **Deploy processor** (`apps/worker/src/processors/deploy.ts`): creates a
  `PipelineRun` with all 8 stages, runs the control-plane stages, snapshots the
  deploy spec **without secrets** into `Deployment.specSnapshot` (for rollback),
  then dispatches a signed `DEPLOY_APP` command (15-minute timeout) and enqueues a
  safety-net `HealthcheckJob` (5-minute delay).
- **Finalization** happens in the API when the node reports
  (`applyCommandResult` → `finalizeSuccessfulDeploy`): a healthy result promotes
  the deployment to `running`, supersedes the previous running deployment, and
  sets `App.currentDeploymentId`/`nodeId`. A failed/timed-out result marks the
  deployment and app `failed` and writes a system error log.
- **Rollback** (`yourstack.rollback`): creates a new deployment from the target's
  `specSnapshot` **plus freshly resolved secrets**, dispatches a signed
  `ROLLBACK_DEPLOYMENT` command, and finalizes through the same path.
- **Safety-net healthcheck**: if a deployment is still non-terminal 5 minutes
  after dispatch, it is marked `failed` (guards against a node that never reports).

---

## 4. CI/CD pipeline stages

`PipelineRunStatus`: `queued → running → succeeded|failed|canceled`.
`PIPELINE_STAGE_ORDER` (each a `PipelineStage` with `StageStatus`
`pending|running|succeeded|failed|skipped`):

| # | Stage | Where it runs | Notes |
| --- | --- | --- | --- |
| 1 | `checkout` | control plane | Resolve ref/commit |
| 2 | `install` | control plane | Dependency resolution step |
| 3 | `test` | control plane | Test gate (delegated to node execution) |
| 4 | `build` | control plane | Build the `DeployAppSpec`; env values redacted in logs |
| 5 | `package` | control plane | Snapshot spec **without secrets**; set image tag/container name; status → `deploying` |
| 6 | `deploy` | node (agent) | Signed `DEPLOY_APP` command runs the container |
| 7 | `healthcheck` | node (agent) | Probe the app; result reported back |
| 8 | `finalize` | control plane | Promote/supersede; close the pipeline run |

Stages 6–8 and the run status are closed out by the API when the node reports the
command result (`closePipelineRun`), not by the worker processor. On any thrown
error the run is marked `failed` and remaining stages `skipped`.

`triggered` sources: `manual` (dashboard/CLI), `push`/`pull_request` (webhook).

---

## 5. Realtime (SSE over Redis pub/sub)

The dashboard/CLI subscribe to server-sent events; the control plane fans events
out across every API instance using one Redis channel.

- **`RealtimeHub`** (`apps/api/src/realtime/hub.ts`) holds two ioredis
  connections. Any process (API **or** worker) calls
  `publish(channel, type, data)`, which publishes JSON `{channel, type, data}` to
  the single global Redis channel **`yourstack:events`**. Every API instance's
  subscriber receives it and dispatches locally to the SSE clients subscribed to
  that logical `channel`.
- **`GET /v1/events?channel=<kind:id>`** authorizes the channel, then streams
  `text/event-stream` with a keep-alive comment every 20s. Authorization by kind:

  | Channel kind | Required permission |
  | --- | --- |
  | `workspace:<id>` | `workspace:view` |
  | `node:<id>` | `node:view` |
  | `app:<id>` | `log:view` |
  | `deployment:<id>` | `log:view` |
  | `pipeline:<runId>` | `pipeline:view` |

- **Event types** published across the system: `node.registered`,
  `node.heartbeat`, `node.status`, `log.runtime`, `log.build`,
  `deployment.created`, `deployment.status`, `domain.status`, `command.queued`,
  `command.update`.

---

## 6. Queues (BullMQ)

`QUEUE_NAMES` and worker concurrency (`apps/worker/src/index.ts`):

| Queue | Name | Concurrency | Purpose |
| --- | --- | --- | --- |
| DEPLOY | `yourstack.deploy` | 4 | Run the deployment pipeline |
| WEBHOOK | `yourstack.webhook` | 8 | Process GitHub push/PR events |
| HEALTHCHECK | `yourstack.healthcheck` | 8 | Safety-net deployment health checks |
| ROLLBACK | `yourstack.rollback` | 4 | Roll back to a prior deployment |
| DOMAIN | `yourstack.domain` | 4 | DNS verification + domain configuration |
| MAINTENANCE | `yourstack.maintenance` | 2 | Scheduled housekeeping |
| PIPELINE | `yourstack.pipeline` | — | Name reserved; pipeline runs inline in the deploy processor |

Repeatable **maintenance** jobs: `node_liveness` (30s), `log_retention` (1h),
`cleanup` (1h; expired sessions/join tokens, old heartbeats), `usage_rollup`
(24h).

---

## 7. Data model summary

Postgres via Prisma (`packages/db/prisma/schema.prisma`). Native enums mirror
`@yourstack/shared/enums.ts` exactly. Core entities and relations:

- **User** ← OAuthAccount, Session, WorkspaceMember, ApiToken, AuditLog. Flag
  `isPlatformAdmin`.
- **Workspace** (belongs to a **Plan**) ← WorkspaceMember (role), Project, Node,
  NodeJoinToken, GitRepository, UsageRecord, ApiToken, AuditLog. `status` =
  `active|suspended`.
- **Project** ← App, Secret.
- **App** (belongs to Project, optional Node) ← AppEnvironment, Deployment,
  Secret, Domain, PipelineRun, RuntimeLog. Tracks `currentDeploymentId`, runtime
  spec (`buildCommand`, `startCommand`, `port`, `cpu`, `memoryMb`,
  `deploymentStrategy`, `healthcheckPath`), `status` (`AppStatus`).
- **AppEnvironment** — `production|preview|development`; scopes secrets.
- **Secret** — `ciphertext` (AES-256-GCM `v1:iv:tag:ct`), `lastFour`; scoped to
  project/app/environment (`SecretScope`). Values are never stored or returned in
  plaintext.
- **Node** — telemetry + resource fields, `commandKey` (HMAC signing key),
  `agentTokenHash` (unique, SHA-256), `disabled`, heartbeat timestamps ← NodeLabel,
  NodeHeartbeat, NodeCommand, App, Deployment.
- **NodeJoinToken** — `tokenHash` (unique), `expiresAt`, `usedAt`, `usedByNode`.
- **NodeCommand** — `type`, `status` (`CommandStatus`), `payload` (signed
  envelope), `signature`, `timeoutMs`, timing columns; indexed by
  `[nodeId,status]` and `[status,issuedAt]`.
- **Deployment** — `version` (unique per app), `status`, image/container fields,
  `specSnapshot` (secret-free, for rollback), `triggeredBy` ← DeploymentLog,
  PipelineRun.
- **PipelineRun** ← PipelineStage (8, ordered).
- **GitRepository** ← GitWebhook (dedup by unique `deliveryId`), App.
- **Domain** — `hostname` (unique), `status` (`DomainStatus`),
  `verificationToken`, `dnsTarget`, `isPreview`.
- **AuditLog** — actor, `action`, target, metadata, ip/user-agent.
- **ApiToken** — `tokenHash` (unique, SHA-256), `lastFour`, `expiresAt`,
  `revokedAt`.

See [SECURITY.md](./SECURITY.md) for how tokens, secrets, and signatures are
handled, and [API.md](./API.md) for the full endpoint surface.
