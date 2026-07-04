# NodeRail Security Model

NodeRail runs untrusted code (user apps) on user-owned servers, orchestrated by a
multi-tenant control plane. This document describes the threat model, the agent's
strictly-bounded capabilities, secret handling, webhook verification, the node
trust model, RBAC, and planned hardening. It reflects the **actual
implementation** in `packages/security/*` and `apps/api/src/*`.

> **Reporting a vulnerability:** please disclose privately to the maintainers.
> Do not open a public issue. Include reproduction steps and impact.

---

## 1. Threat model

**Assets**

- Tenant source, secrets, and deployed workloads.
- The control-plane database (Postgres) and event/queue bus (Redis).
- Node agent credentials and the per-node command-signing key.
- User sessions and personal API tokens.

**Trust boundaries**

1. **Browser/CLI ↔ API** — cookie sessions or Bearer tokens over TLS.
2. **API ↔ Worker** — shared Postgres + Redis inside the control-plane network.
3. **Control plane ↔ Node agent** — the internet. This is the highest-risk
   boundary: the node runs on hardware NodeRail does not control.
4. **Node agent ↔ user workloads** — the agent supervises Docker containers.

**Adversaries considered**

- A malicious or compromised **tenant** trying to reach another tenant's data,
  nodes, or secrets (multi-tenancy isolation).
- A **compromised node** replaying, forging, or tampering with commands, or
  reading another node's work.
- A **network attacker** intercepting or replaying agent/webhook traffic.
- A **malicious webhook sender** forging GitHub events to trigger deploys.
- An **insider** with a low-privilege workspace role escalating privileges.

**Explicit non-goals (today)**

- Defending a node's host kernel against a container escape from the tenant's own
  workload (the node owner runs their own hardware; sandboxing is on the roadmap).
- mTLS / certificate pinning between agent and control plane (roadmap).

---

## 2. What the agent CAN and CANNOT do

The agent is the sharpest edge of the system, so its authority is bounded **by
construction**, not by policy.

**CAN** — execute exactly the eight typed commands (`CommandType`):
`DEPLOY_APP`, `STOP_APP`, `RESTART_APP`, `REMOVE_APP`, `STREAM_LOGS`,
`HEALTH_CHECK`, `CONFIGURE_DOMAIN`, `ROLLBACK_DEPLOYMENT`. Each carries a typed,
schema-validated payload (`commandPayloadSchema` is a discriminated union). The
agent maps these to specific Docker/Caddy operations.

**CANNOT**

- Run arbitrary shell or arbitrary commands. **There is no `RUN_SHELL` / free-form
  command type** — the command union has no escape hatch. An operator cannot
  "just run a script" through the protocol.
- Execute an **unsigned or tampered** command. Every command envelope is verified
  against the node's HMAC key before execution (§5); a bad signature is rejected.
- Act for another node. The command key and agent token are per-node; a node only
  ever receives commands addressed to its own `nodeId`.
- Retain platform credentials. The agent holds only its own agent token (which the
  server stores hashed) and its command-verification key.

This "typed commands only" design means a compromised control-plane bug surface
still cannot turn into "run anything on every node," and a compromised node cannot
forge work for others.

---

## 3. Secret handling

Implemented in `packages/security/src/encryption.ts` and enforced across the API,
worker, and log pipeline.

### At rest — AES-256-GCM

- `SECRETS_ENCRYPTION_KEY` is a **64 hex character (32 byte)** key, validated by
  `/^[0-9a-fA-F]{64}$/`. In production the config layer additionally rejects an
  all-zero key.
- The `Encryptor` uses **AES-256-GCM** with a fresh random **12-byte IV** per
  encryption and a GCM authentication tag. Ciphertext is stored as a versioned,
  self-describing string:

  ```
  v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
  ```

  Decryption requires the `v1` version prefix and exactly four parts, verifies the
  auth tag (tamper detection), and rejects malformed input. Secret rows persist
  only this ciphertext plus a `lastFour` hint.

### In transit — TLS + signed commands

Secret **values** are never returned by the API (`toSecretDTO` exposes only
metadata + `lastFour`). They are injected into a deployment only inside the
signed `DEPLOY_APP`/`ROLLBACK_DEPLOYMENT` command `env` payload, delivered over
TLS to the target node. Rollbacks re-resolve secrets fresh — the immutable
`specSnapshot` used for rollback is stored **without** secret values.

### In logs — redaction

`packages/security/src/redaction.ts` scrubs known secret values and high-signal
patterns before any log line is persisted or streamed:

- All secret values of length ≥ 4 are matched **longest-first** (so short values
  can't leave partial masks) and replaced with `***REDACTED***`.
- Heuristic patterns catch credentials even if they aren't registered secrets:
  NodeRail tokens (`nr_`, `nra_`, `nrj_`), GitHub PATs (`ghp_…`, `github_pat_…`),
  AWS access keys (`AKIA…`), Slack tokens (`xox[baprs]-…`), and PEM private-key
  blocks.

The API's pino logger also redacts `authorization`, `cookie`, `password`, and
`token` fields on request logs.

---

## 4. Webhook signature verification (HMAC over raw body)

`POST /v1/webhooks/github` is only enabled when `GITHUB_WEBHOOK_SECRET` is set.
The server preserves the **raw request bytes** (`req.rawBody`) via a custom
`application/json` content-type parser, because signatures must be computed over
the exact bytes GitHub signed — not a re-serialized JSON object.

`verifyGithubWebhook(rawBody, signatureHeader, secret)`:

1. Requires the `x-hub-signature-256: sha256=<hex>` header (missing → reject).
2. Computes `HMAC_SHA256(secret, rawBody)`.
3. Compares in **constant time** (`timingSafeEqual`, length-guarded).

Mismatches return `401`. Unknown repositories are ignored. Deliveries are
**deduplicated** by the unique `x-github-delivery` id (`GitWebhook.deliveryId`),
persisted, and enqueued as a `WebhookJob`; the endpoint returns `202`.

---

## 5. Node trust model

Three credential types, all stored **only as SHA-256 hashes**
(`packages/security/src/tokens.ts`): sessions, personal API tokens, and agent
tokens. Plaintext is shown exactly once at creation.

### 5.1 One-time expiring join tokens

- Minted by `POST /v1/workspaces/:id/nodes/join-token` (permission `node:join`),
  subject to the plan's `maxNodes`.
- Format `nrj_…` (32 bytes, base64url). Only the SHA-256 **hash** is stored
  (`NodeJoinToken.tokenHash`, unique).
- **TTL 15 minutes** (`JOIN_TOKEN_TTL_MS`), **single use** — registration sets
  `usedAt`/`usedByNode`, and the `cleanup` maintenance job purges expired/old
  tokens.

### 5.2 Registration → per-node credentials

On `POST /v1/agent/register` with a valid join token, the API mints:

- an **agent token** (`nra_…`, 40 bytes) — stored as `Node.agentTokenHash`
  (unique SHA-256); the agent presents it as `Authorization: Bearer nra_…`.
- a **command key** (32 random bytes, hex) — stored as `Node.commandKey`, the
  HMAC key for signing that node's commands.

Agent authentication (`authenticateNode`) looks the node up by
`agentTokenHash = hashToken(token)`, additionally runs a constant-time
`verifyToken`, and rejects if `node.disabled` (403). Removing a node
(`DELETE /v1/nodes/:id`) **nulls `agentTokenHash`**, immediately revoking the
agent.

### 5.3 Per-node HMAC command signing

Every command is signed with that node's `commandKey` over the canonical JSON of
`{ id, nodeId, payload, timeoutMs, issuedAt }` (see
[ARCHITECTURE.md §2.4](./ARCHITECTURE.md#24-command-signing-hmac-sha256)). The
agent recomputes the canonical bytes and verifies the HMAC before executing. This
gives **integrity + authenticity**: a network attacker or a different node cannot
forge or tamper with a command, because they don't hold the target node's key. The
`issuedAt` + `timeoutMs` fields bound a command's validity window and limit replay
value.

### 5.4 Bearer agent tokens hashed at rest

As above — the server never stores an agent token, session token, or API token in
plaintext; it stores `SHA-256` hashes and compares in constant time. A database
disclosure does not hand an attacker usable credentials.

### 5.5 Password hashing (email accounts)

Primary auth is GitHub OAuth, but local/email accounts use **scrypt**
(`N=16384, r=8, p=1`, 64-byte key, 16-byte random salt), stored as
`scrypt$N$r$p$salt$hash` and verified in constant time.

---

## 6. RBAC — roles & permissions

Defined in `packages/shared/src/rbac.ts`. Permissions are `resource:action`
atoms; roles are cumulative sets (`WorkspaceRole`, ranked
`owner > admin > developer > viewer`). Every mutating route calls
`requirePermission(...)`; reads call `requireUser`/`requirePermission` with a
`*:view` atom.

| Role | Capabilities (cumulative) |
| --- | --- |
| **viewer** | All `*:view` reads (workspace, member, project, app, node, secret metadata, domain, log, repo, pipeline). `secret:view` never exposes values. |
| **developer** | viewer + create/update projects & apps, `app:deploy`/`rollback`/`control`, `node:join`/`update`/`drain`, `secret:write`/`delete`, `domain:write`/`delete`, `repo:connect`, `pipeline:trigger`, `token:view`/`create`. |
| **admin** | developer + `workspace:update`, member invite/role/remove, `project:delete`, `app:delete`, `node:remove`, `token:revoke`, `audit:view`. |
| **owner** | All permissions, including `workspace:delete` and `workspace:billing`. |

**Platform admins** (identities listed in `ADMIN_EMAILS`, `User.isPlatformAdmin`)
get owner-level access to any workspace and a dedicated `/v1/admin/*` surface
(cross-tenant stats, suspend workspace, disable node), each guarded by
`requirePlatformAdmin` and audited (`admin.workspace_suspend`,
`admin.node_disable`).

Helpers: `roleHasPermission(role, perm)`, `permissionsForRole(role)`,
`roleAtLeast(role, min)`.

### Baseline HTTP hardening (`apps/api/src/plugins/security.ts`)

- **Helmet** security headers; **CORS** restricted to `PUBLIC_WEB_URL` +
  `CORS_ORIGINS` with credentials.
- **Cookies** signed with `SESSION_SECRET`; `httpOnly`, `sameSite=lax`,
  `secure` in production, optional `SESSION_COOKIE_DOMAIN`. Session cookie is
  `nr_session`, 30-day TTL.
- **Rate limiting** (Redis-backed) keyed by user id or IP, default
  `RATE_LIMIT_MAX=300` per `RATE_LIMIT_WINDOW=1 minute`; `/health` and `/metrics`
  are allowlisted.
- Request body limit 5 MiB; `trustProxy` enabled for correct client IPs behind the
  edge.

---

## 7. Audit logging

`packages/security/src/audit.ts` defines a canonical `AuditAction` catalog
(`auth.login`, `workspace.create`, `node.join_token_create`, `node.register`,
`app.deploy`, `secret.create`, `token.revoke`, `admin.workspace_suspend`, …).
Every sensitive mutation writes an `AuditLog` row capturing actor, action, target,
metadata, IP, and user agent. Workspace admins can read their audit trail
(`GET /v1/workspaces/:id/audit`, `audit:view`); platform admins can read across
tenants.

---

## 8. Future hardening

Tracked, not yet implemented:

- **mTLS** between agent and control plane (currently Bearer token + per-command
  HMAC over TLS), with certificate pinning.
- **Firecracker/gVisor-sandboxed build execution** to isolate tenant build steps
  from the node host.
- **Signed, reproducible agent binaries** with release attestation so operators
  can verify the agent they install.
- **SSO / SAML / SCIM** for enterprise workspaces and centralized deprovisioning.
- **SOC2-style tamper-evident audit logs** (hash-chained / append-only export).
- Nonce-based **replay protection** for agent command results in addition to the
  `issuedAt`/`timeoutMs` validity window.
- **Secret key rotation** tooling (the `v1:` ciphertext prefix already reserves
  room for versioned re-encryption).
- Slimmer, minimal-surface runtime container images.
