//! Command dispatch.
//!
//! An [`Executor`] takes a *verified* [`NodeCommand`] and runs the matching
//! handler under the command's `timeoutMs`, transitioning status by posting
//! results to the control plane: `accepted` → `running` → `succeeded` /
//! `failed` / `timed_out`. Build and runtime logs are streamed back through the
//! logs endpoint.
//!
//! The executor only ever runs the typed handlers below — there is no path to
//! execute arbitrary shell from the control plane.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::mpsc;

use crate::api::ApiClient;
use crate::caddy::CaddyManager;
use crate::docker::{run_healthcheck, DockerClient};
use crate::protocol::{
    CommandOutput, CommandPayload, CommandResultBody, CommandStatus, DeployAppSpec, LogBatch,
    LogEvent, LogSeverity, LogStream, NodeCommand,
};
use crate::util::now_iso8601;

pub struct Executor {
    api: ApiClient,
    docker: Option<DockerClient>,
    caddy: CaddyManager,
    node_id: String,
}

impl Executor {
    pub fn new(
        api: ApiClient,
        docker: Option<DockerClient>,
        caddy: CaddyManager,
        node_id: String,
    ) -> Self {
        Executor {
            api,
            docker,
            caddy,
            node_id,
        }
    }

    /// Execute a verified command end-to-end, reporting all status transitions.
    pub async fn execute(self: &Arc<Self>, command: NodeCommand) {
        let started = Instant::now();
        let command_id = command.id.clone();
        let type_name = command.payload.type_name();
        tracing::info!(%command_id, command_type = type_name, "executing command");

        // Acknowledge receipt.
        self.report(
            &command_id,
            CommandStatus::Accepted,
            CommandOutput::default(),
            None,
        )
        .await;
        self.report(
            &command_id,
            CommandStatus::Running,
            CommandOutput::default(),
            None,
        )
        .await;

        let timeout = Duration::from_millis(command.timeout_ms.max(1) as u64);
        let this = Arc::clone(self);
        let cmd_id_for_run = command_id.clone();
        let result =
            tokio::time::timeout(timeout, this.dispatch(command.payload, cmd_id_for_run)).await;

        match result {
            Err(_elapsed) => {
                tracing::warn!(%command_id, "command timed out");
                self.report(
                    &command_id,
                    CommandStatus::TimedOut,
                    CommandOutput::default(),
                    Some("command exceeded its timeout".to_string()),
                )
                .await;
            }
            Ok(Ok(mut output)) => {
                output.duration_ms = Some(started.elapsed().as_millis() as i64);
                self.report(&command_id, CommandStatus::Succeeded, output, None)
                    .await;
                tracing::info!(%command_id, "command succeeded");
            }
            Ok(Err(err)) => {
                let mut output = CommandOutput::default();
                output.duration_ms = Some(started.elapsed().as_millis() as i64);
                tracing::error!(%command_id, error = %err, "command failed");
                self.report(
                    &command_id,
                    CommandStatus::Failed,
                    output,
                    Some(format!("{err:#}")),
                )
                .await;
            }
        }
    }

    /// Route a payload to its handler.
    async fn dispatch(
        self: Arc<Self>,
        payload: CommandPayload,
        command_id: String,
    ) -> Result<CommandOutput> {
        match payload {
            CommandPayload::DeployApp { spec } => self.deploy_app(&spec, &command_id).await,
            CommandPayload::RollbackDeployment { spec } => {
                // Rolling back is a deploy of the target deployment's spec.
                self.deploy_app(&spec.spec, &command_id).await
            }
            CommandPayload::StopApp { spec } => {
                let docker = self.require_docker()?;
                docker
                    .stop_container(&spec.container_name, spec.timeout_seconds)
                    .await?;
                Ok(CommandOutput {
                    message: Some(format!("stopped {}", spec.container_name)),
                    ..Default::default()
                })
            }
            CommandPayload::RestartApp { spec } => {
                let docker = self.require_docker()?;
                docker.restart_container(&spec.container_name).await?;
                Ok(CommandOutput {
                    message: Some(format!("restarted {}", spec.container_name)),
                    ..Default::default()
                })
            }
            CommandPayload::RemoveApp { spec } => {
                let docker = self.require_docker()?;
                docker
                    .remove_container(&spec.container_name, spec.remove_volumes)
                    .await?;
                Ok(CommandOutput {
                    message: Some(format!("removed {}", spec.container_name)),
                    ..Default::default()
                })
            }
            CommandPayload::HealthCheck { spec } => {
                let healthy = run_healthcheck(
                    spec.healthcheck.port,
                    &spec.healthcheck.path,
                    spec.healthcheck.expect_status,
                    spec.healthcheck.retries,
                    spec.healthcheck.interval_ms,
                    spec.healthcheck.timeout_ms,
                )
                .await;
                Ok(CommandOutput {
                    message: Some(format!(
                        "healthcheck {} -> {}",
                        spec.container_name,
                        if healthy { "healthy" } else { "unhealthy" }
                    )),
                    healthy: Some(healthy),
                    ..Default::default()
                })
            }
            CommandPayload::ConfigureDomain { spec } => {
                let msg = self
                    .caddy
                    .configure_domain(&spec.domain, spec.domain.target_port)
                    .await?;
                Ok(CommandOutput {
                    message: Some(msg),
                    ..Default::default()
                })
            }
            CommandPayload::StreamLogs { spec } => {
                self.stream_logs(
                    &spec.app_id,
                    &spec.container_name,
                    &command_id,
                    spec.tail,
                    spec.follow,
                    spec.since_seconds,
                )
                .await
            }
        }
    }

    /// Deploy (or roll back to) an app spec: prepare image, run container,
    /// healthcheck, optionally configure the domain.
    async fn deploy_app(&self, spec: &DeployAppSpec, command_id: &str) -> Result<CommandOutput> {
        let docker = self.require_docker()?;

        if let Some(net) = &spec.network_name {
            docker.ensure_network(net).await?;
        }

        // Build/pull the image, forwarding build logs.
        let prepared = docker.prepare_image(spec).await?;
        self.post_build_logs(spec, command_id, &prepared.build_logs)
            .await;

        // Bring up the container with resource limits.
        let run = docker.run_container(spec, &prepared.image_ref).await?;

        // Optional healthcheck against the published host port.
        let mut healthy: Option<bool> = None;
        if let Some(hc) = &spec.healthcheck {
            let host_port = run.host_port.unwrap_or(hc.port);
            let ok = run_healthcheck(
                host_port,
                &hc.path,
                hc.expect_status,
                hc.retries,
                hc.interval_ms,
                hc.timeout_ms,
            )
            .await;
            healthy = Some(ok);
            if !ok {
                return Err(anyhow!(
                    "container {} started but failed healthcheck on :{host_port}{}",
                    spec.container_name,
                    hc.path
                ));
            }
        }

        // Optional domain routing via Caddy.
        if let Some(domain) = &spec.domain {
            if let Some(host_port) = run.host_port {
                match self.caddy.configure_domain(domain, host_port).await {
                    Ok(msg) => tracing::info!(%command_id, "{msg}"),
                    Err(e) => {
                        tracing::warn!(%command_id, error = %e, "domain configuration failed")
                    }
                }
            }
        }

        Ok(CommandOutput {
            message: Some(format!(
                "deployed {} (deployment {})",
                spec.container_name, spec.deployment_id
            )),
            container_id: Some(run.container_id),
            image_digest: prepared.digest,
            host_port: run.host_port.map(|p| p as i64),
            healthy,
            ..Default::default()
        })
    }

    /// Stream container logs to the control plane until `follow` completes or the
    /// command times out. Batches lines to reduce request volume.
    async fn stream_logs(
        &self,
        app_id: &str,
        container: &str,
        command_id: &str,
        tail: u64,
        follow: bool,
        since_seconds: Option<i64>,
    ) -> Result<CommandOutput> {
        let docker = self.require_docker()?;
        let (tx, mut rx) = mpsc::channel::<String>(256);
        let container_owned = container.to_string();
        let docker_clone = docker.clone();
        let producer = tokio::spawn(async move {
            let _ = docker_clone
                .stream_logs(&container_owned, tail, follow, since_seconds, tx)
                .await;
        });

        let mut total = 0u64;
        let mut batch: Vec<LogEvent> = Vec::new();
        loop {
            // Wait for a line, but flush periodically even if idle.
            let next = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
            match next {
                Ok(Some(line)) => {
                    total += 1;
                    batch.push(LogEvent {
                        app_id: app_id.to_string(),
                        deployment_id: None,
                        node_id: Some(self.node_id.clone()),
                        stream: LogStream::Runtime,
                        severity: LogSeverity::Info,
                        message: line,
                        timestamp: now_iso8601(),
                        meta: None,
                    });
                    if batch.len() >= 100 {
                        self.flush_logs(command_id, std::mem::take(&mut batch))
                            .await;
                    }
                }
                Ok(None) => break, // producer finished
                Err(_) => {
                    // Idle flush.
                    if !batch.is_empty() {
                        self.flush_logs(command_id, std::mem::take(&mut batch))
                            .await;
                    }
                }
            }
        }
        if !batch.is_empty() {
            self.flush_logs(command_id, batch).await;
        }
        producer.abort();

        Ok(CommandOutput {
            message: Some(format!("streamed {total} log lines from {container}")),
            ..Default::default()
        })
    }

    fn require_docker(&self) -> Result<&DockerClient> {
        self.docker
            .as_ref()
            .ok_or_else(|| anyhow!("Docker is not available on this node"))
    }

    /// Post build logs (stream=build, tied to the deployment).
    async fn post_build_logs(&self, spec: &DeployAppSpec, command_id: &str, lines: &[String]) {
        if lines.is_empty() {
            return;
        }
        let events: Vec<LogEvent> = lines
            .iter()
            .map(|l| LogEvent {
                app_id: spec.app_id.clone(),
                deployment_id: Some(spec.deployment_id.clone()),
                node_id: Some(self.node_id.clone()),
                stream: LogStream::Build,
                severity: LogSeverity::Info,
                message: l.clone(),
                timestamp: now_iso8601(),
                meta: None,
            })
            .collect();
        // Chunk to respect the API's 1000-event cap.
        for chunk in events.chunks(500) {
            self.flush_logs(command_id, chunk.to_vec()).await;
        }
    }

    async fn flush_logs(&self, command_id: &str, events: Vec<LogEvent>) {
        if events.is_empty() {
            return;
        }
        let batch = LogBatch {
            command_id: Some(command_id.to_string()),
            events,
        };
        if let Err(e) = self.api.post_logs(&batch).await {
            tracing::warn!(%command_id, error = %e, "failed to post logs");
        }
    }

    /// Post a command result, logging (but not propagating) transport failures so
    /// the daemon loop keeps running.
    async fn report(
        &self,
        command_id: &str,
        status: CommandStatus,
        output: CommandOutput,
        error: Option<String>,
    ) {
        let body = CommandResultBody {
            status,
            output,
            error,
        };
        if let Err(e) = self.api.post_result(command_id, &body).await {
            tracing::warn!(%command_id, error = %e, "failed to post command result");
        }
    }
}
