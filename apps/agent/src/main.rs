//! YourStack node agent.
//!
//! A single static binary that a "bring your own server" operator installs on
//! their machine. It registers with the YourStack control plane using a one-time
//! join token, then runs as a daemon: reporting telemetry, long-polling for
//! cryptographically-signed typed commands, and executing them against Docker.
//!
//! Security model: the agent verifies an HMAC-SHA256 signature on every command
//! before acting, and there is deliberately no command variant that runs an
//! arbitrary shell. See the module docs in `signing.rs` and `executor.rs`.

mod api;
mod caddy;
mod config;
mod daemon;
mod docker;
mod executor;
mod protocol;
mod resources;
mod signing;
mod telemetry;
mod util;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use crate::config::{default_config_path, dev_config_path, Config};
use crate::protocol::NodeRegisterRequest;

#[derive(Parser)]
#[command(
    name = "yourstack-agent",
    version,
    about = "YourStack node agent — registers a server and executes signed deployment commands"
)]
struct Cli {
    /// Override the config file path (defaults to /etc/yourstack/agent.toml on
    /// Linux, else ./agent.toml).
    #[arg(long, global = true)]
    config: Option<PathBuf>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the daemon (default when no subcommand is given).
    Run,
    /// One-time registration with the control plane; writes agent.toml.
    Register {
        #[arg(long)]
        api_url: String,
        #[arg(long)]
        join_token: String,
        #[arg(long)]
        name: String,
        /// Optional region label stored with the node.
        #[arg(long)]
        region: Option<String>,
        /// Container runtime to drive: `docker` (default) or `podman`.
        #[arg(long)]
        runtime: Option<String>,
        /// Explicit Engine API socket/URL (overrides the runtime default and
        /// DOCKER_HOST), e.g. `unix:///run/user/1000/podman/podman.sock`.
        #[arg(long)]
        engine_socket: Option<String>,
    },
    /// Development mode: verbose logging, local ./agent.toml.
    Dev,
    /// Print version and protocol information.
    Version,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command.unwrap_or(Command::Run) {
        Command::Version => {
            println!(
                "yourstack-agent {} (protocol v{})",
                env!("CARGO_PKG_VERSION"),
                protocol::AGENT_PROTOCOL_VERSION
            );
            Ok(())
        }
        Command::Register {
            api_url,
            join_token,
            name,
            region,
            runtime,
            engine_socket,
        } => {
            init_tracing(false);
            let path = cli.config.unwrap_or_else(default_config_path);
            let runtime = parse_runtime(runtime.as_deref())?;
            register(
                &path,
                &api_url,
                &join_token,
                &name,
                region,
                runtime,
                engine_socket,
            )
            .await
        }
        Command::Dev => {
            init_tracing(true);
            let path = cli.config.unwrap_or_else(dev_config_path);
            let cfg = Config::load(&path).with_context(|| {
                format!(
                    "loading dev config at {} (run `yourstack-agent register` first)",
                    path.display()
                )
            })?;
            daemon::run(cfg).await
        }
        Command::Run => {
            init_tracing(false);
            let path = cli.config.unwrap_or_else(default_config_path);
            let cfg = Config::load(&path)
                .with_context(|| format!("loading config at {}", path.display()))?;
            daemon::run(cfg).await
        }
    }
}

/// Map an optional `--runtime` string to the config enum (default: Docker).
fn parse_runtime(s: Option<&str>) -> Result<config::ContainerRuntime> {
    match s.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("docker") => Ok(config::ContainerRuntime::Docker),
        Some("podman") => Ok(config::ContainerRuntime::Podman),
        Some(other) => Err(anyhow::anyhow!(
            "unknown --runtime '{other}' (expected 'docker' or 'podman')"
        )),
    }
}

/// Perform the one-time join and persist credentials.
async fn register(
    path: &std::path::Path,
    api_url: &str,
    join_token: &str,
    name: &str,
    region: Option<String>,
    runtime: config::ContainerRuntime,
    engine_socket: Option<String>,
) -> Result<()> {
    // Data dir determines where builds/caddy fragments live; default per-OS.
    let mut cfg = Config {
        api_url: api_url.to_string(),
        region: region.clone(),
        runtime,
        engine_socket,
        ..Default::default()
    };

    // Collect registration telemetry (best-effort container-engine version).
    let docker = docker::DockerClient::connect(
        PathBuf::from(&cfg.data_dir),
        cfg.runtime,
        cfg.engine_socket.clone(),
    )
    .ok();
    let mut collector = telemetry::Collector::new();
    let telemetry = collector.register_telemetry(docker.as_ref()).await;

    let client = api::ApiClient::new(api_url, None)?;
    let req = NodeRegisterRequest {
        join_token: join_token.to_string(),
        name: name.to_string(),
        telemetry,
    };
    tracing::info!(%api_url, name, "registering node");
    let resp = client
        .register(&req)
        .await
        .context("registration request failed")?;

    cfg.node_id = resp.node_id.clone();
    cfg.agent_token = resp.agent_token;
    cfg.command_verify_key = resp.command_verify_key;
    cfg.save(path).context("saving agent.toml")?;

    tracing::info!(
        node_id = %resp.node_id,
        heartbeat_interval_ms = resp.heartbeat_interval_ms,
        config = %path.display(),
        "registration successful"
    );
    println!(
        "Registered as node {}. Config written to {}.",
        resp.node_id,
        path.display()
    );
    Ok(())
}

/// Initialize structured logging. `verbose` bumps the default level to debug.
fn init_tracing(verbose: bool) {
    use tracing_subscriber::{fmt, EnvFilter};
    let default = if verbose { "debug" } else { "info" };
    let filter = EnvFilter::try_from_env("YOURSTACK_LOG")
        .or_else(|_| EnvFilter::try_new(default))
        .unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).with_target(false).init();
}
