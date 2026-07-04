# Contributing to NodeRail

Thanks for your interest in NodeRail — _bring your own server, we turn it into a cloud._
This guide covers local setup, the repo layout, coding standards, and the PR
workflow.

## Code of Conduct

Be excellent to each other. Harassment, discrimination, and hostile behavior are
not tolerated. Report concerns to the maintainers.

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9 (`corepack enable` then `corepack prepare pnpm@9 --activate`)
- **Docker** + Docker Compose (for Postgres, Redis, and image builds)
- **Rust** >= 1.80 (only if you work on the node agent in `apps/agent`)

## Getting started

```bash
git clone <repo-url> noderail && cd noderail
pnpm install
cp .env.example .env                 # control-plane env for `pnpm dev`
cp infra/.env.example infra/.env     # env for the docker-compose stack
pnpm docker:up                       # postgres + redis (+ api/worker/web images)
pnpm db:migrate                      # apply Prisma migrations
pnpm db:seed                         # optional demo data
pnpm dev                             # run all apps in watch mode
```

See the [README](./README.md) for the full walkthrough and the
[Architecture guide](./docs/ARCHITECTURE.md) for how the pieces fit together.

## Repository layout

```
apps/
  api/      Fastify control-plane API (TypeScript, ESM, tsup)
  worker/   BullMQ background worker (deploy pipeline, maintenance)
  web/      Next.js dashboard
  cli/      `noderail` command-line client
  agent/    Rust node agent (runs on user servers)
packages/
  config/   Typed env loading (zod)
  db/       Prisma schema, migrations, seed
  security/ Encryption, signing, tokens, redaction, RBAC helpers
  shared/   Constants, enums, RBAC catalog, zod schemas, queue contracts
infra/      docker-compose, Dockerfiles, Caddy, Railway templates
docs/       Architecture, security, deployment, API, checklists
.github/    CI workflows
```

## Development workflow

Everything is orchestrated with [Turborepo](https://turbo.build) and pnpm
workspaces. Common commands:

| Command | Description |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode (parallel) |
| `pnpm build` | Build every package/app |
| `pnpm -r typecheck` | Typecheck all workspaces |
| `pnpm -r lint` | Lint (ESLint, `--max-warnings 0`) |
| `pnpm -r test` | Run Vitest suites |
| `pnpm db:migrate:dev` | Create + apply a new migration during dev |
| `pnpm format` | Prettier write |

Scope commands to one workspace with `--filter`, e.g.
`pnpm --filter @noderail/api dev`.

## Coding standards

- **TypeScript strict**, ESM everywhere. No `any` without justification.
- **Lint must pass with zero warnings** (`eslint --max-warnings 0`).
- **Format with Prettier** before committing (`pnpm format`).
- Add or update **Vitest** tests for behavior changes.
- Keep the **authoritative env list** in `packages/config/src/index.ts` — never
  read `process.env` directly in app code; go through `loadConfig()`.
- Shared enums/constants live in `packages/shared`; the Prisma enums and the Rust
  agent structs must stay in lockstep with them.

### Database changes

1. Edit `packages/db/prisma/schema.prisma`.
2. Run `pnpm db:migrate:dev` to generate a migration.
3. Commit the generated migration folder under `packages/db/prisma/migrations`.
4. CI runs `prisma migrate diff --exit-code` and fails on un-migrated drift.

### Security-sensitive changes

Anything touching authentication, the agent command protocol, secret handling,
webhook verification, or RBAC must be reviewed against
[docs/SECURITY.md](./docs/SECURITY.md). Never introduce a free-form/shell command
type into the agent protocol — commands are strictly typed by design.

## Commit & PR guidelines

- Use clear, imperative commit messages (Conventional Commits encouraged:
  `feat:`, `fix:`, `docs:`, `chore:` …).
- Keep PRs focused. Include a description of _what_ and _why_.
- Ensure `pnpm -r typecheck && pnpm -r lint && pnpm -r build && pnpm -r test`
  pass locally; CI runs the same plus the Rust agent build and Docker image
  builds.
- Link related issues.

## Reporting security vulnerabilities

Do **not** open a public issue for security reports. See the disclosure guidance
in [docs/SECURITY.md](./docs/SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[Apache License 2.0](./LICENSE).
