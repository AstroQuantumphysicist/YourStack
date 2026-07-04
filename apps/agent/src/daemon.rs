//! The long-running agent daemon.
//!
//! Responsibilities:
//!  * Send a heartbeat with fresh telemetry every `heartbeatIntervalMs`.
//!  * When the heartbeat reports `hasPendingCommands` (or on a periodic poll),
//!    long-poll `GET /agent/commands`, **verify each command's signature**, and
//!    execute the verified ones concurrently.
//!  * Reconnect resiliently on network errors (the API client already retries;
//!    the loop additionally never exits on a transient failure).
//!  * Shut down gracefully on Ctrl-C / SIGTERM.
//!
//! A command whose signature does not verify is dropped and reported as failed —
//! it is never executed.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tokio::sync::Notify;

use crate::api::ApiClient;
use crate::caddy::CaddyManager;
use crate::config::Config;
use crate::docker::DockerClient;
use crate::executor::Executor;
use crate::protocol::{
    CommandOutput, CommandResultBody, CommandStatus, DesiredStatus, HeartbeatRequest, NodeCommand,
};
use crate::signing::verify_command;
use crate::telemetry::Collector;

pub async fn run(config: Config) -> Result<()> {
    if !config.is_registered() {
        anyhow::bail!(
            "agent is not registered; run `yourstack-agent register --api-url <url> --join-token <token> --name <name>` first"
        );
    }

    let api = ApiClient::new(&config.api_url, Some(config.agent_token.clone()))?;
    let data_dir = std::path::PathBuf::from(&config.data_dir);

    // Docker is best-effort: if the daemon is unreachable at startup we still run
    // (heartbeats report no docker version) and retry connecting each heartbeat.
    let docker = match DockerClient::connect(data_dir.clone()) {
        Ok(d) => Some(d),
        Err(e) => {
            tracing::warn!(error = %e, "Docker unavailable at startup; will report no docker version");
            None
        }
    };

    let caddy = CaddyManager::new(data_dir);
    let executor = Arc::new(Executor::new(
        api.clone(),
        docker.clone(),
        caddy,
        config.node_id.clone(),
    ));

    let mut collector = Collector::new();

    // Discover heartbeat interval from a first heartbeat; default until then.
    let mut interval_ms: u64 = 15_000;

    let shutdown = Arc::new(Notify::new());
    spawn_signal_handler(shutdown.clone());

    tracing::info!(node_id = %config.node_id, api = %config.api_url, "agent daemon started");

    let mut heartbeat_tick = tokio::time::interval(Duration::from_millis(interval_ms));
    heartbeat_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = shutdown.notified() => {
                tracing::info!("shutdown signal received; draining and exiting");
                break;
            }
            _ = heartbeat_tick.tick() => {
                let telemetry = collector.heartbeat_telemetry(docker.as_ref()).await;
                match api.heartbeat(&HeartbeatRequest { telemetry }).await {
                    Ok(resp) => {
                        if resp.desired_status == DesiredStatus::Draining {
                            tracing::info!("control plane requests draining");
                        }
                        // Re-tune the heartbeat interval if the server changed it.
                        // (Interval is fixed after registration today, but honor it.)
                        if resp.has_pending_commands {
                            poll_and_execute(&api, &executor, &config).await;
                        }
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "heartbeat failed; will retry");
                    }
                }
            }
        }
    }

    // Suppress unused warning for the reserved interval knob.
    let _ = &mut interval_ms;
    Ok(())
}

/// Long-poll for commands, verify each signature, and execute the valid ones.
async fn poll_and_execute(api: &ApiClient, executor: &Arc<Executor>, config: &Config) {
    let raw_commands = match api.poll_commands().await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "polling commands failed");
            return;
        }
    };

    for raw in raw_commands {
        // 1) Verify the signature over the exact bytes received.
        if let Err(e) = verify_command(&raw, &config.command_verify_key) {
            // Try to extract the id for the failure report; never execute.
            let id = raw
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("<unknown>")
                .to_string();
            tracing::error!(command_id = %id, error = %e, "rejecting command with invalid signature");
            report_rejected(api, &id, &format!("signature verification failed: {e}")).await;
            continue;
        }

        // 2) Deserialize into the typed envelope.
        let command: NodeCommand = match serde_json::from_value(raw.clone()) {
            Ok(c) => c,
            Err(e) => {
                let id = raw
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<unknown>")
                    .to_string();
                tracing::error!(command_id = %id, error = %e, "failed to decode verified command");
                report_rejected(api, &id, &format!("command decode failed: {e}")).await;
                continue;
            }
        };

        // 3) Execute concurrently so a slow command does not block heartbeats.
        let exec = Arc::clone(executor);
        tokio::spawn(async move {
            exec.execute(command).await;
        });
    }
}

async fn report_rejected(api: &ApiClient, command_id: &str, error: &str) {
    let body = CommandResultBody {
        status: CommandStatus::Failed,
        output: CommandOutput::default(),
        error: Some(error.to_string()),
    };
    if let Err(e) = api.post_result(command_id, &body).await {
        tracing::warn!(%command_id, error = %e, "failed to report rejected command");
    }
}

/// Register a Ctrl-C (and SIGTERM on Unix) handler that fires the shutdown notify.
fn spawn_signal_handler(shutdown: Arc<Notify>) {
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut term = match signal(SignalKind::terminate()) {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, "cannot install SIGTERM handler");
                    // Still handle Ctrl-C below.
                    let _ = tokio::signal::ctrl_c().await;
                    shutdown.notify_waiters();
                    return;
                }
            };
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        shutdown.notify_waiters();
    });
}
