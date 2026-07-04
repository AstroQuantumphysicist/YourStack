# `yourstack` — the YourStack developer CLI

Ship apps to your own servers from the terminal. The CLI talks to the YourStack
API (`@yourstack/api`) using a **personal API token** and streams live build /
runtime logs over Server-Sent Events.

```bash
yourstack login
yourstack init          # link this directory to a project + scaffold yourstack.yml
yourstack node join     # add one of your servers
yourstack deploy        # ship it, tailing build logs until it's live
```

## Install / run

Within the monorepo:

```bash
pnpm --filter @yourstack/cli build
node apps/cli/dist/index.js --help
```

The build produces a self-contained `dist/index.js` with a `#!/usr/bin/env node`
shebang and a `yourstack` bin entry, so once published/linked you can run
`yourstack <command>` directly.

Scripts: `pnpm --filter @yourstack/cli <dev|build|start|typecheck|lint|test|clean>`.

## Configuration & authentication

Credentials live in `~/.yourstack/config.json` (written with `0600`
permissions). Every command resolves settings in this order:

1. Command-line flags: `--api-url <url>`, `--token <token>`
2. Environment: `YOURSTACK_API_URL`, `YOURSTACK_TOKEN`
3. Stored config (`~/.yourstack/config.json`)
4. Defaults (`--api-url` defaults to `http://localhost:4000`)

Get an API token from the web dashboard (**Workspace → Tokens → Create**); it is
shown once and starts with `ys_`.

Set `YOURSTACK_DEBUG=1` to print full stack traces on unexpected errors.

## Global options

| Flag              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `--api-url <url>` | Override the API base URL for this invocation.         |
| `--token <token>` | Override the API token for this invocation.            |
| `-v, --version`   | Print the CLI version.                                 |
| `-h, --help`      | Show help for any command.                             |

## Commands

### `yourstack login`

Authenticate and store your token after validating it against `/auth/me`.

```bash
yourstack login                        # interactive token prompt
yourstack login --token ys_xxx         # non-interactive
YOURSTACK_TOKEN=ys_xxx yourstack login  # via environment
yourstack login --api-url https://api.yourstack.example
```

### `yourstack whoami`

Show the authenticated user and their workspaces.

```bash
yourstack whoami
yourstack whoami --json
```

### `yourstack logout`

Clear stored credentials (and best-effort end the server session).

```bash
yourstack logout
```

### `yourstack init`

Interactively link the current directory to a workspace + project (creating a
project if needed), optionally create the app on the server, scaffold a
`yourstack.yml`, and write `.yourstack/project.json` (which records
`workspaceId` / `projectId` / `appId` for other commands).

```bash
yourstack init
yourstack init --name my-service
```

`yourstack.yml` matches `@yourstack/shared`'s `yourstackConfigSchema`:

```yaml
name: my-service
on:
  push:
    branches:
      - main
  pull_request: false
build:
  install: pnpm install
  command: pnpm build
deploy:
  start: pnpm start
  port: 3000
  resources: {}
```

### `yourstack node join`

Create a one-time join token for a workspace and print the install command to
run on the server you want to add.

```bash
yourstack node join
yourstack node join --workspace ws_123 --label web-1 --region us-east
yourstack node join --print-token        # reveal the raw join token
yourstack node join --json
```

### `yourstack node list` (alias `ls`)

List the nodes (servers) in a workspace.

```bash
yourstack node list
yourstack node ls --workspace ws_123 --json
```

### `yourstack deploy`

Resolve the app from `.yourstack/project.json` (or `--app`), trigger a
deployment, and stream build logs until the deployment reaches a terminal
state. Exits non-zero if the deployment does not end up `running`.

```bash
yourstack deploy
yourstack deploy --app app_123 --ref feature/x --reason "hotfix"
yourstack deploy --no-follow             # queue and return immediately
```

### `yourstack logs`

Stream live runtime logs for an app, or build logs for a specific deployment.
Stored history is printed first, then the CLI follows in real time (Ctrl-C to
stop).

```bash
yourstack logs                                   # linked app, follow
yourstack logs --app app_123 --since 2026-07-04T00:00:00Z
yourstack logs --no-follow --json                # print stored logs and exit
yourstack logs --deployment dep_123              # build logs for a deployment
```

### `yourstack apps list` (alias `ls`)

List apps in the linked (or given) project as a table.

```bash
yourstack apps list
yourstack apps ls --project proj_123 --json
```

### `yourstack env set KEY=VALUE …`

Set one or more app-scoped secrets. Keys must be uppercase env-var names.
Redeploy for changes to take effect.

```bash
yourstack env set DATABASE_URL=postgres://user:pass@host/db
yourstack env set API_KEY=abc123 LOG_LEVEL=debug
yourstack env set --app app_123 SECRET="value with spaces"
```

### `yourstack rollback`

Roll an app back to a previous deployment. Without `--to`, pick a target from a
list of recent deployments.

```bash
yourstack rollback
yourstack rollback --to dep_123 --yes
yourstack rollback --app app_123
```

### `yourstack version`

Print the CLI version (same as `-v`/`--version`).

## JSON output

`whoami`, `node join`, `node list`, `apps list`, and `logs` accept `--json` for
scripting. Human-readable tables and colored status are used otherwise.

## Error handling

Friendly messages are shown for common failures:

- **401** — not logged in (prompts you to run `yourstack login`)
- **402** — plan limit reached
- **403** — insufficient permission
- **404 / 409 / 422 / 429** — clear, specific messages
- **network errors** — connection guidance including the API URL in use

## Development

```bash
pnpm --filter @yourstack/cli dev        # tsx watch
pnpm --filter @yourstack/cli typecheck
pnpm --filter @yourstack/cli test       # vitest
```

Tests cover the SSE frame parser, `KEY=VALUE` parsing, config load/save
round-trips, and `yourstack.yml` scaffolding (validated against the shared
schema).
