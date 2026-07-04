# YourStack Production Checklist

Work through this before taking a YourStack control plane live. See
[DEPLOYMENT.md](./DEPLOYMENT.md) for the how, and [SECURITY.md](./SECURITY.md) for
the why.

## Secrets & environment

- [ ] `SESSION_SECRET` is a real random value (`openssl rand -hex 32`), **not** the
      example, and does not start with `change-me`.
- [ ] `SECRETS_ENCRYPTION_KEY` is **exactly 64 hex chars (32 bytes)**, random, and
      **not** all zeros. Stored in a secrets manager and backed up separately from
      the database.
- [ ] `NODE_ENV=production` on **api** and **worker**.
- [ ] `DATABASE_URL` and `REDIS_URL` point at production datastores (Railway
      references or managed instances), shared by api + worker.
- [ ] `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, and `CORS_ORIGINS` match the real public
      domains (no `localhost`).
- [ ] `NEXT_PUBLIC_API_URL` set as a **build-time** arg for the web image and equal
      to `PUBLIC_API_URL`.
- [ ] `BASE_PREVIEW_DOMAIN` set to a real wildcard-capable domain if using preview
      environments.
- [ ] No real secret values committed to the repo (`.env` git-ignored).

## Identity & access

- [ ] `ADMIN_EMAILS` set to your platform-admin identities only.
- [ ] GitHub OAuth app created; `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` set;
      callback URL = `{PUBLIC_API_URL}/v1/auth/github/callback`.
- [ ] `GITHUB_WEBHOOK_SECRET` set if using push/PR deploys (webhook HMAC
      verification is otherwise disabled).
- [ ] `dev-login` is confirmed disabled in production (it is, by `NODE_ENV`).

## Database & migrations

- [ ] Migrations applied (`prisma migrate deploy`) — api pre-deploy step succeeded
      on first deploy.
- [ ] CI migration-drift check (`prisma migrate diff --exit-code`) is green.
- [ ] Seed data reviewed (don't ship demo/admin seed accounts to prod).

## TLS & networking

- [ ] All public traffic is HTTPS; the api sits behind a TLS-terminating edge.
- [ ] Session cookies are `secure` (automatic when `NODE_ENV=production`);
      `SESSION_COOKIE_DOMAIN` set if using cross-subdomain auth.
- [ ] `trustProxy` is effective (correct client IPs for rate limiting/audit).

## Availability & health

- [ ] api `healthcheckPath = /health` configured; `/ready` returns `200`
      (Postgres + Redis reachable).
- [ ] Restart policies configured (`ON_FAILURE`, retries) on api + worker.
- [ ] Worker running and draining queues (`yourstack_commands_queued` not growing
      unbounded).

## Monitoring & observability

- [ ] `/metrics` scraped by Prometheus (or equivalent); alerts on
      `yourstack_nodes_online` dropping and `yourstack_commands_queued` climbing.
- [ ] `LOG_LEVEL` appropriate for prod (`info`); log shipping configured.
- [ ] Alerting on failed deployments / node offline transitions.

## Rate limits & abuse

- [ ] `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` tuned for expected traffic (defaults
      `300 / minute`).
- [ ] Plan limits (`maxNodes`, `maxApps`, `maxDeploymentsPerDay`) reflect your
      tiers.

## Log retention & data lifecycle

- [ ] `LOG_RETENTION_DAYS` set (default 14); the `log_retention` maintenance job
      is running.
- [ ] `cleanup` and `usage_rollup` maintenance jobs confirmed running (expired
      sessions/join tokens purged, usage pruned).

## Backups & recovery

- [ ] Automated Postgres backups scheduled **and a restore tested**.
- [ ] `SECRETS_ENCRYPTION_KEY` backed up in a secrets manager (a DB backup is
      unrecoverable without it).
- [ ] Redis persistence (AOF) enabled; understood that Redis is not a system of
      record.
- [ ] Disaster-recovery runbook documented (restore DB + key, redeploy, rejoin
      nodes if needed).

## Nodes (data plane)

- [ ] First node joined via a single-use join token (15-min TTL) and reporting
      heartbeats.
- [ ] Node reachable from the control plane's `PUBLIC_API_URL`.
- [ ] Node's Caddy edge terminating TLS for deployed apps.
