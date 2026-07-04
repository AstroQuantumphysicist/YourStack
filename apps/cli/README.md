# `noderail` — the NodeRail developer CLI

Ship apps to your own servers from the terminal. The CLI talks to the NodeRail
API (`@noderail/api`) using a **personal API token** and streams live build /
runtime logs over Server-Sent Events.

```bash
noderail login
noderail init          # link this directory to a project + scaffold noderail.yml
noderail node join     # add one of your servers
noderail deploy        # ship it, tailing build logs until it's live
```

## Install / run

Within the monorepo:

```bash
pnpm --filter @noderail/cli build
node apps/cli/dist/index.js --help
```

The build produces a self-contained `dist/index.js` with a `#!/usr/bin/env node`
shebang and a `noderail` bin entry, so once published/linked you can run
`noderail <command>` directly.

Scripts: `pnpm --filter @noderail/cli <dev|build|start|typecheck|lint|test|clean>`.

## Configuration & authentication

Credentials live in `~/.noderail/config.json` (written with `0600`
permissions). Every command resolves settings in this order:

1. Command-line flags: `--api-url <url>`, `--token <token>`
2. Environment: `NODERAIL_API_URL`, `NODERAIL_TOKEN`
3. Stored config (`~/.noderail/config.json`)
4. Defaults (`--api-url` defaults to `http://localhost:4000`)

Get an API token from the web dashboard (**Workspace → Tokens → Create**); it is
shown once and starts with `nr_`.

Set `NODERAIL_DEBUG=1` to print full stack traces on unexpected errors.

## Global options

| Flag              | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `--api-url <url>` | Override the API base URL for this invocation.         |
| `--token <token>` | Override the API token for this invocation.            |
| `-v, --version`   | Print the CLI version.                                 |
| `-h, --help`      | Show help for any command.                             |

## Commands

### `noderail login`

Authenticate and store your token after validating it against `/auth/me`.

```bash
noderail login                        # interactive token prompt
noderail login --token nr_xxx         # non-interactive
NODERAIL_TOKEN=nr_xxx noderail login  # via environment
noderail login --api-url https://api.noderail.example
```

### `noderail whoami`

Show the authenticated user and their workspaces.

```bash
noderail whoami
noderail whoami --json
```

### `noderail logout`

Clear stored credentials (and best-effort end the server session).

```bash
noderail logout
```

### `noderail init`

Interactively link the current directory to a workspace + project (creating a
project if needed), optionally create the app on the server, scaffold a
`noderail.yml`, and write `.noderail/project.json` (which records
`workspaceId` / `projectId` / `appId` for other commands).

```bash
noderail init
noderail init --name my-service
```

`noderail.yml` matches `@noderail/shared`'s `noderailConfigSchema`:

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

### `noderail node join`

Create a one-time join token for a workspace and print the install command to
run on the server you want to add.

```bash
noderail node join
noderail node join --workspace ws_123 --label web-1 --region us-east
noderail node join --print-token        # reveal the raw join token
noderail node join --json
```

### `noderail node list` (alias `ls`)

List the nodes (servers) in a workspace.

```bash
noderail node list
noderail node ls --workspace ws_123 --json
```

### `noderail deploy`

Resolve the app from `.noderail/project.json` (or `--app`), trigger a
deployment, and stream build logs until the deployment reaches a terminal
state. Exits non-zero if the deployment does not end up `running`.

```bash
noderail deploy
noderail deploy --app app_123 --ref feature/x --reason "hotfix"
noderail deploy --no-follow             # queue and return immediately
```

### `noderail logs`

Stream live runtime logs for an app, or build logs for a specific deployment.
Stored history is printed first, then the CLI follows in real time (Ctrl-C to
stop).

```bash
noderail logs                                   # linked app, follow
noderail logs --app app_123 --since 2026-07-04T00:00:00Z
noderail logs --no-follow --json                # print stored logs and exit
noderail logs --deployment dep_123              # build logs for a deployment
```

### `noderail apps list` (alias `ls`)

List apps in the linked (or given) project as a table.

```bash
noderail apps list
noderail apps ls --project proj_123 --json
```

### `noderail env set KEY=VALUE …`

Set one or more app-scoped secrets. Keys must be uppercase env-var names.
Redeploy for changes to take effect.

```bash
noderail env set DATABASE_URL=postgres://user:pass@host/db
noderail env set API_KEY=abc123 LOG_LEVEL=debug
noderail env set --app app_123 SECRET="value with spaces"
```

### `noderail rollback`

Roll an app back to a previous deployment. Without `--to`, pick a target from a
list of recent deployments.

```bash
noderail rollback
noderail rollback --to dep_123 --yes
noderail rollback --app app_123
```

### `noderail version`

Print the CLI version (same as `-v`/`--version`).

## JSON output

`whoami`, `node join`, `node list`, `apps list`, and `logs` accept `--json` for
scripting. Human-readable tables and colored status are used otherwise.

## Error handling

Friendly messages are shown for common failures:

- **401** — not logged in (prompts you to run `noderail login`)
- **402** — plan limit reached
- **403** — insufficient permission
- **404 / 409 / 422 / 429** — clear, specific messages
- **network errors** — connection guidance including the API URL in use

## Development

```bash
pnpm --filter @noderail/cli dev        # tsx watch
pnpm --filter @noderail/cli typecheck
pnpm --filter @noderail/cli test       # vitest
```

Tests cover the SSE frame parser, `KEY=VALUE` parsing, config load/save
round-trips, and `noderail.yml` scaffolding (validated against the shared
schema).
