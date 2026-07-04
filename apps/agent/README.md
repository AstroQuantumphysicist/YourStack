# YourStack Agent

The Rust node agent for YourStack's "bring your own server" platform. It runs on
an operator's machine, registers with the control plane using a one-time join
token, and then executes cryptographically-signed, strongly-typed deployment
commands against the local Docker daemon.

It is a single static binary (`yourstack-agent`) with no runtime dependencies
other than Docker (and Caddy if you use custom domains).

## Contents

- `src/` — the agent (see module map below)
- `scripts/install.sh`, `scripts/uninstall.sh` — POSIX installers
- `systemd/yourstack-agent.service` — hardened systemd unit
- `agent.toml.example` — annotated config

### Module map

| Module | Responsibility |
| --- | --- |
| `protocol.rs` | serde structs mirroring `@yourstack/shared` (commands, telemetry, logs) |
| `signing.rs` | canonical JSON + HMAC-SHA256 command signature verification |
| `config.rs` | load/save `agent.toml` |
| `api.rs` | typed HTTP client with retry/backoff |
| `telemetry.rs` | system + Docker telemetry via `sysinfo` and bollard |
| `docker.rs` | bollard-based container lifecycle; git/build shell-outs |
| `caddy.rs` | reverse-proxy + automatic HTTPS for custom domains |
| `executor.rs` | dispatch a verified command, honoring `timeoutMs` |
| `daemon.rs` | heartbeat + command poll loop, graceful shutdown |

## Build

```sh
cargo build            # debug
cargo build --release  # optimized static binary at target/release/yourstack-agent
cargo test             # unit tests (canonical JSON + HMAC verify, timestamps)
```

Builds are cross-platform (Linux, macOS, Windows). Docker/Caddy/systemd are
driven at runtime via the Docker API, CLI shell-outs, and generated files, so no
Linux-only crates are required.

## The join flow

1. In the YourStack dashboard (or CLI) create a **join token** (`ysj_...`). It is
   single-use and short-lived (15 minutes).
2. On the target server, register:

   ```sh
   yourstack-agent register \
     --api-url https://api.yourstack.dev \
     --join-token ysj_xxx \
     --name my-edge-box
   ```

   This calls `POST /v1/agent/register`, receives `{ nodeId, agentToken,
   commandVerifyKey, heartbeatIntervalMs }`, and writes them to `agent.toml`
   (mode `0600`).
3. Run the daemon:

   ```sh
   yourstack-agent run          # uses /etc/yourstack/agent.toml on Linux
   yourstack-agent dev          # verbose logging, local ./agent.toml
   ```

The daemon heartbeats every `heartbeatIntervalMs`, long-polls `GET
/v1/agent/commands`, verifies each command's signature, executes it, and reports
results to `POST /v1/agent/commands/:id/result`. Build/runtime logs are shipped
to `POST /v1/agent/logs`.

## One-line install (systemd)

```sh
sudo YOURSTACK_API_URL=https://api.yourstack.dev \
     YOURSTACK_JOIN_TOKEN=ysj_xxx \
     YOURSTACK_BINARY_URL=https://dl.yourstack.dev/agent/latest/yourstack-agent \
     ./scripts/install.sh
```

The installer creates the `yourstack` system user (added to the `docker` group),
writes `/etc/yourstack/agent.toml`, registers the node, and installs + starts the
systemd unit. It is idempotent — re-run it to upgrade the binary. Uninstall with
`sudo ./scripts/uninstall.sh` (`PURGE_DATA=1` to also drop `/var/lib/yourstack`).

### Podman instead of Docker

Both engines speak the Docker Engine API, so the agent drives either. Pass
`YOURSTACK_RUNTIME=podman` to the installer — it enables the rootful
`podman.socket`, adds the agent user to the `podman` group, records
`runtime = "podman"` in `agent.toml`, and shells out to `podman build` for image
builds. The agent auto-discovers the Podman socket
(`$XDG_RUNTIME_DIR/podman/podman.sock`, then `/run/podman/podman.sock`); override
it with `YOURSTACK_ENGINE_SOCKET=unix:///path/to.sock` (or set `DOCKER_HOST`).
Everything else — deploys, databases, functions, firewalls, metrics — is
identical across engines.

## Security model

- **Signed commands only.** Every command is delivered with an HMAC-SHA256
  signature over the canonical JSON of `{id, nodeId, payload, timeoutMs,
  issuedAt}`, keyed by the per-node `commandVerifyKey` (the hex key is
  **hex-decoded to bytes** before use, matching the control plane). The agent
  verifies the signature over the *exact bytes received* and refuses to execute
  anything that does not verify. Invalid commands are reported as `failed`.
- **No arbitrary shell.** There is deliberately no `RUN_SHELL` command variant.
  The agent only runs the fixed, typed handlers (deploy, stop, restart, remove,
  stream logs, healthcheck, configure domain, rollback). `git`/`docker`/`caddy`
  are shelled out with fixed argument vectors, never with control-plane strings
  as a shell command line.
- **Least privilege.** Runs as the unprivileged `yourstack` user. The systemd
  unit applies `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, a
  private `/tmp`, and a narrow `ReadWritePaths`. Engine socket access is granted
  only via `docker`/`podman` group membership.
- **Secrets at rest.** `agent.toml` holds the agent token and HMAC key and is
  written `0600`, owned by the `yourstack` user.
- **TLS.** All control-plane traffic uses HTTPS (rustls); container env (which
  may contain decrypted secrets) is only ever transmitted over that channel.

## Custom domains (Caddy)

`CONFIGURE_DOMAIN` maps a hostname to a container's published port with automatic
HTTPS. **Caddy must be installed on the node.** The agent first tries the Caddy
admin API at `http://localhost:2019`; if it is unreachable it writes a Caddyfile
fragment under `{data_dir}/caddy/` and runs `caddy reload`.

## Caveats

- The Caddy admin API is assumed at `http://localhost:2019` with the default
  server name `srv0`; otherwise the Caddyfile fallback is used.
- Image builds shell out to `docker build` and `git clone`, so both must be on
  `PATH` for git/buildpack sources (image sources only need the Docker daemon).
- `publicIp` telemetry is reported as `null` (the control plane can derive the
  source IP from the request); wire in a metadata lookup if you need it.
