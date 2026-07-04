//! Docker execution layer.
//!
//! Container lifecycle (pull, create with resource limits, start, stop, restart,
//! remove, logs, inspect) goes through the bollard Engine API. Image *builds*
//! from a git source shell out to `git` + `docker build`, which is both simpler
//! and closer to how operators expect builds to behave. Everything here compiles
//! cross-platform: bollard talks to the local Docker socket / named pipe, and the
//! `git`/`docker` CLIs are invoked via `tokio::process`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine as _;
use bollard::auth::DockerCredentials;
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, LogOutput, LogsOptions,
    RemoveContainerOptions, StatsOptions, StopContainerOptions,
};
use bollard::image::CreateImageOptions;
use bollard::models::{HostConfig, PortBinding, RestartPolicy, RestartPolicyNameEnum};
use bollard::network::CreateNetworkOptions;
use bollard::Docker;
use futures_util::StreamExt;
use tokio::sync::mpsc;

use crate::config::ContainerRuntime;
use crate::protocol::{
    DeployAppSpec, DeploySource, Framework, LABEL_APP, LABEL_DEPLOYMENT, LABEL_MANAGED,
};

/// A resolved image plus any build output produced while preparing it.
pub struct PreparedImage {
    pub image_ref: String,
    pub digest: Option<String>,
    /// Build/pull log lines to forward to the control plane.
    pub build_logs: Vec<String>,
}

/// Result of bringing up a container.
pub struct RunResult {
    pub container_id: String,
    pub host_port: Option<u16>,
}

/// A single resource-usage sample for one managed container, paired with its
/// Docker labels so the caller can map it to an app/database/function id.
#[derive(Debug, Clone)]
pub struct ContainerSample {
    pub labels: HashMap<String, String>,
    pub cpu_percent: f64,
    pub mem_mb: f64,
    pub mem_percent: f64,
    pub net_rx_kb: f64,
    pub net_tx_kb: f64,
    pub disk_mb: f64,
}

#[derive(Clone)]
pub struct DockerClient {
    docker: Docker,
    data_dir: PathBuf,
    runtime: ContainerRuntime,
}

impl DockerClient {
    /// Connect to the local container engine. Both Docker and Podman speak the
    /// Docker Engine API; `runtime` picks the default socket and the build CLI,
    /// and `socket` (if set) overrides the endpoint for either.
    pub fn connect(
        data_dir: PathBuf,
        runtime: ContainerRuntime,
        socket: Option<String>,
    ) -> Result<Self> {
        let docker = connect_engine(runtime, socket.as_deref())?;
        Ok(DockerClient {
            docker,
            data_dir,
            runtime,
        })
    }

    /// Borrow the underlying bollard client for higher-level modules (resources).
    pub(crate) fn engine(&self) -> &Docker {
        &self.docker
    }

    /// The container runtime this client drives (selects the build/prune CLI).
    pub(crate) fn runtime(&self) -> ContainerRuntime {
        self.runtime
    }

    /// The agent's data directory (build workspaces, generated sources).
    pub(crate) fn data_dir(&self) -> &std::path::Path {
        &self.data_dir
    }

    /// Pull an image if needed (idempotent). Returns progress log lines.
    pub(crate) async fn ensure_image(&self, image: &str) -> Result<Vec<String>> {
        self.pull_image(image, None).await
    }

    /// Pull an image with optional base64 `user:pass` registry auth (private
    /// images). Idempotent; returns progress log lines.
    pub(crate) async fn ensure_image_auth(
        &self,
        image: &str,
        registry_auth: Option<&str>,
    ) -> Result<Vec<String>> {
        self.pull_image(image, registry_auth).await
    }

    /// Server version string, or `None` if the daemon is unreachable.
    pub async fn version(&self) -> Result<Option<String>> {
        let v = self.docker.version().await.context("docker version")?;
        Ok(v.version)
    }

    /// App ids (or container ids) of running, agent-managed containers.
    pub async fn list_managed_apps(&self) -> Result<Vec<String>> {
        let mut filters: HashMap<String, Vec<String>> = HashMap::new();
        filters.insert("label".to_string(), vec![format!("{LABEL_MANAGED}=true")]);
        let opts = ListContainersOptions {
            all: false,
            filters,
            ..Default::default()
        };
        let containers = self
            .docker
            .list_containers(Some(opts))
            .await
            .context("listing managed containers")?;
        let mut ids = Vec::new();
        for c in containers {
            if let Some(labels) = &c.labels {
                if let Some(app) = labels.get(LABEL_APP) {
                    ids.push(app.clone());
                    continue;
                }
            }
            if let Some(id) = c.id {
                ids.push(id);
            }
        }
        Ok(ids)
    }

    /// Ensure a user-defined bridge network exists (idempotent).
    pub async fn ensure_network(&self, name: &str) -> Result<()> {
        let opts = CreateNetworkOptions {
            name: name.to_string(),
            driver: "bridge".to_string(),
            ..Default::default()
        };
        match self.docker.create_network(opts).await {
            Ok(_) => Ok(()),
            Err(e) => {
                // A 409 (already exists) is fine; anything else is a real error.
                let msg = e.to_string();
                if msg.contains("already exists") || msg.contains("409") {
                    Ok(())
                } else {
                    Err(anyhow!(e)).context("creating network")
                }
            }
        }
    }

    /// Prepare the deployable image: pull it (image source) or build it (git /
    /// buildpack source). Returns the local image reference and any digest.
    pub async fn prepare_image(&self, spec: &DeployAppSpec) -> Result<PreparedImage> {
        match &spec.source {
            DeploySource::Image {
                image,
                registry_auth,
            } => {
                let logs = self.pull_image(image, registry_auth.as_deref()).await?;
                let digest = self.image_digest(image).await;
                Ok(PreparedImage {
                    image_ref: image.clone(),
                    digest,
                    build_logs: logs,
                })
            }
            DeploySource::Git {
                repo_url,
                git_ref,
                context_path,
                dockerfile,
                clone_token,
            } => {
                let mut logs = Vec::new();
                let dir = self
                    .clone_repo(
                        repo_url,
                        git_ref,
                        clone_token.as_deref(),
                        &spec.deployment_id,
                        &mut logs,
                    )
                    .await?;
                let context = dir.join(context_path);
                let dockerfile_path = context.join(dockerfile);
                let build_logs = self
                    .docker_build(&context, Some(&dockerfile_path), &spec.image_tag)
                    .await?;
                logs.extend(build_logs);
                let digest = self.image_digest(&spec.image_tag).await;
                Ok(PreparedImage {
                    image_ref: spec.image_tag.clone(),
                    digest,
                    build_logs: logs,
                })
            }
            DeploySource::Buildpack {
                repo_url,
                git_ref,
                framework,
                install_command,
                build_command,
                start_command,
                clone_token,
            } => {
                let mut logs = Vec::new();
                let dir = self
                    .clone_repo(
                        repo_url,
                        git_ref,
                        clone_token.as_deref(),
                        &spec.deployment_id,
                        &mut logs,
                    )
                    .await?;
                // Generate a Dockerfile for the framework unless the repo has one.
                let dockerfile_contents = generate_dockerfile(
                    *framework,
                    install_command.as_deref(),
                    build_command.as_deref(),
                    start_command.as_deref(),
                    default_port(spec),
                );
                let dockerfile_path = dir.join("Dockerfile.yourstack");
                tokio::fs::write(&dockerfile_path, dockerfile_contents)
                    .await
                    .context("writing generated Dockerfile")?;
                logs.push(format!(
                    "[buildpack] generated Dockerfile for framework {:?}",
                    framework
                ));
                let build_logs = self
                    .docker_build(&dir, Some(&dockerfile_path), &spec.image_tag)
                    .await?;
                logs.extend(build_logs);
                let digest = self.image_digest(&spec.image_tag).await;
                Ok(PreparedImage {
                    image_ref: spec.image_tag.clone(),
                    digest,
                    build_logs: logs,
                })
            }
        }
    }

    /// Pull an image via the Engine API, decoding optional base64 `user:pass`
    /// registry auth. Returns human-readable progress lines.
    async fn pull_image(&self, image: &str, registry_auth: Option<&str>) -> Result<Vec<String>> {
        let credentials = registry_auth.and_then(decode_registry_auth);
        let (from_image, tag) = split_image_tag(image);
        let opts = CreateImageOptions {
            from_image: from_image.clone(),
            tag: tag.clone(),
            ..Default::default()
        };
        let mut stream = self.docker.create_image(Some(opts), None, credentials);
        let mut logs = Vec::new();
        while let Some(item) = stream.next().await {
            match item {
                Ok(info) => {
                    if let Some(status) = info.status {
                        let progress = info.progress.unwrap_or_default();
                        logs.push(format!("[pull] {status} {progress}").trim_end().to_string());
                    }
                }
                Err(e) => bail!("pulling {image}: {e}"),
            }
        }
        logs.push(format!("[pull] completed {image}"));
        Ok(logs)
    }

    /// Best-effort image digest lookup (RepoDigests[0] or image id).
    async fn image_digest(&self, image: &str) -> Option<String> {
        match self.docker.inspect_image(image).await {
            Ok(info) => info
                .repo_digests
                .and_then(|d| d.into_iter().next())
                .or(info.id),
            Err(_) => None,
        }
    }

    /// Clone a git repo (shallow) at `git_ref` into the data dir. Injects the
    /// clone token into the URL for private HTTPS repos.
    pub(crate) async fn clone_repo(
        &self,
        repo_url: &str,
        git_ref: &str,
        clone_token: Option<&str>,
        deployment_id: &str,
        logs: &mut Vec<String>,
    ) -> Result<PathBuf> {
        let dest = self.data_dir.join("builds").join(deployment_id);
        // Start clean so retries are deterministic.
        let _ = tokio::fs::remove_dir_all(&dest).await;
        tokio::fs::create_dir_all(&dest)
            .await
            .context("creating build directory")?;

        let auth_url = inject_clone_token(repo_url, clone_token);
        logs.push(format!("[git] cloning {repo_url} @ {git_ref}"));
        // --depth 1 with a specific ref: clone then checkout to support tags/SHAs.
        let output = tokio::process::Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg("--branch")
            .arg(git_ref)
            .arg(&auth_url)
            .arg(&dest)
            .output()
            .await
            .context("spawning git clone")?;
        if !output.status.success() {
            // Fall back to a full clone + checkout for non-branch refs (SHAs).
            let _ = tokio::fs::remove_dir_all(&dest).await;
            tokio::fs::create_dir_all(&dest).await.ok();
            let clone = tokio::process::Command::new("git")
                .arg("clone")
                .arg(&auth_url)
                .arg(&dest)
                .output()
                .await
                .context("spawning git clone (full)")?;
            if !clone.status.success() {
                bail!(
                    "git clone failed: {}",
                    String::from_utf8_lossy(&clone.stderr)
                );
            }
            let checkout = tokio::process::Command::new("git")
                .arg("-C")
                .arg(&dest)
                .arg("checkout")
                .arg(git_ref)
                .output()
                .await
                .context("spawning git checkout")?;
            if !checkout.status.success() {
                bail!(
                    "git checkout {git_ref} failed: {}",
                    String::from_utf8_lossy(&checkout.stderr)
                );
            }
        }
        logs.push("[git] clone complete".to_string());
        Ok(dest)
    }

    /// Build an image by shelling out to the runtime CLI (`docker`/`podman`
    /// build — identical flags). Streams combined output into the log lines.
    pub(crate) async fn docker_build(
        &self,
        context: &std::path::Path,
        dockerfile: Option<&std::path::Path>,
        tag: &str,
    ) -> Result<Vec<String>> {
        let mut cmd = tokio::process::Command::new(self.runtime.cli_bin());
        cmd.arg("build").arg("-t").arg(tag);
        if let Some(df) = dockerfile {
            cmd.arg("-f").arg(df);
        }
        cmd.arg(context);
        let output = cmd.output().await.context("spawning docker build")?;
        let mut logs: Vec<String> = Vec::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            logs.push(format!("[build] {line}"));
        }
        for line in String::from_utf8_lossy(&output.stderr).lines() {
            logs.push(format!("[build] {line}"));
        }
        if !output.status.success() {
            bail!("docker build failed for {tag}:\n{}", logs.join("\n"));
        }
        Ok(logs)
    }

    /// Create and start a container for the deployment. Applies resource limits
    /// (NanoCPUs / Memory), env, labels, port bindings, and network membership.
    /// Uses `basic_replace`: any existing container with the same name is removed
    /// first so the deploy is idempotent.
    pub async fn run_container(&self, spec: &DeployAppSpec, image_ref: &str) -> Result<RunResult> {
        // Remove any prior container with this name (basic replace).
        let _ = self
            .docker
            .remove_container(
                &spec.container_name,
                Some(RemoveContainerOptions {
                    force: true,
                    v: false,
                    link: false,
                }),
            )
            .await;

        // Resolve the primary published port (first mapping), allocating an
        // ephemeral host port when none is requested.
        let mut port_bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
        let mut exposed_ports: HashMap<String, HashMap<(), ()>> = HashMap::new();
        let mut primary_host_port: Option<u16> = None;
        for mapping in &spec.ports {
            let host_port = match mapping.host_port {
                Some(p) => p,
                None => allocate_ephemeral_port()?,
            };
            if primary_host_port.is_none() {
                primary_host_port = Some(host_port);
            }
            let key = format!("{}/{}", mapping.container_port, mapping.protocol);
            exposed_ports.insert(key.clone(), HashMap::new());
            port_bindings.insert(
                key,
                Some(vec![PortBinding {
                    host_ip: Some("0.0.0.0".to_string()),
                    host_port: Some(host_port.to_string()),
                }]),
            );
        }

        let env: Vec<String> = spec.env.iter().map(|(k, v)| format!("{k}={v}")).collect();

        let mut labels: HashMap<String, String> = HashMap::new();
        labels.insert(LABEL_MANAGED.to_string(), "true".to_string());
        labels.insert(LABEL_APP.to_string(), spec.app_id.clone());
        labels.insert(LABEL_DEPLOYMENT.to_string(), spec.deployment_id.clone());
        for (k, v) in &spec.labels {
            labels.insert(k.clone(), v.clone());
        }

        // Convert CPU cores -> NanoCPUs, memory MB -> bytes.
        let nano_cpus = (spec.resources.cpu * 1_000_000_000.0).round() as i64;
        let memory_bytes = spec.resources.memory_mb.saturating_mul(1024 * 1024);

        let host_config = HostConfig {
            nano_cpus: Some(nano_cpus),
            memory: Some(memory_bytes),
            port_bindings: if port_bindings.is_empty() {
                None
            } else {
                Some(port_bindings)
            },
            network_mode: spec.network_name.clone(),
            restart_policy: Some(RestartPolicy {
                name: Some(RestartPolicyNameEnum::UNLESS_STOPPED),
                maximum_retry_count: None,
            }),
            ..Default::default()
        };

        let config = Config {
            image: Some(image_ref.to_string()),
            env: if env.is_empty() { None } else { Some(env) },
            labels: Some(labels),
            exposed_ports: if exposed_ports.is_empty() {
                None
            } else {
                Some(exposed_ports)
            },
            host_config: Some(host_config),
            ..Default::default()
        };

        let create = self
            .docker
            .create_container(
                Some(CreateContainerOptions {
                    name: spec.container_name.clone(),
                    platform: None,
                }),
                config,
            )
            .await
            .context("creating container")?;

        self.docker
            .start_container(
                &spec.container_name,
                None::<bollard::container::StartContainerOptions<String>>,
            )
            .await
            .context("starting container")?;

        Ok(RunResult {
            container_id: create.id,
            host_port: primary_host_port,
        })
    }

    /// Stop a container with a grace period (seconds).
    pub async fn stop_container(&self, name: &str, timeout_seconds: i64) -> Result<()> {
        self.docker
            .stop_container(name, Some(StopContainerOptions { t: timeout_seconds }))
            .await
            .context("stopping container")?;
        Ok(())
    }

    /// Restart a container.
    pub async fn restart_container(&self, name: &str) -> Result<()> {
        self.docker
            .restart_container(name, None::<bollard::container::RestartContainerOptions>)
            .await
            .context("restarting container")?;
        Ok(())
    }

    /// Remove a container (force), optionally removing anonymous volumes.
    pub async fn remove_container(&self, name: &str, remove_volumes: bool) -> Result<()> {
        self.docker
            .remove_container(
                name,
                Some(RemoveContainerOptions {
                    force: true,
                    v: remove_volumes,
                    link: false,
                }),
            )
            .await
            .context("removing container")?;
        Ok(())
    }

    /// Stream container logs into `tx`. Honors `tail`, `since`, and `follow`; the
    /// caller bounds the lifetime (e.g. via the command timeout).
    pub async fn stream_logs(
        &self,
        container: &str,
        tail: u64,
        follow: bool,
        since_seconds: Option<i64>,
        tx: mpsc::Sender<String>,
    ) -> Result<()> {
        let since = since_seconds
            .map(|s| now_epoch().saturating_sub(s))
            .unwrap_or(0);
        let opts = LogsOptions::<String> {
            follow,
            stdout: true,
            stderr: true,
            since,
            tail: tail.to_string(),
            timestamps: false,
            ..Default::default()
        };
        let mut stream = self.docker.logs(container, Some(opts));
        while let Some(item) = stream.next().await {
            match item {
                Ok(output) => {
                    let line = log_output_to_string(&output);
                    for l in line.lines() {
                        if tx.send(l.to_string()).await.is_err() {
                            return Ok(()); // receiver dropped
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.send(format!("[logs] stream error: {e}")).await;
                    break;
                }
            }
        }
        Ok(())
    }
}

impl DockerClient {
    /// Sample one-shot resource stats for every running `io.yourstack.managed`
    /// container, computing CPU%, memory, and cumulative network/disk figures.
    /// Best-effort per container: a failing stat is skipped, not fatal.
    pub async fn sample_managed_containers(&self) -> Result<Vec<ContainerSample>> {
        let mut filters: HashMap<String, Vec<String>> = HashMap::new();
        filters.insert("label".to_string(), vec![format!("{LABEL_MANAGED}=true")]);
        let opts = ListContainersOptions {
            all: false,
            filters,
            ..Default::default()
        };
        let containers = self
            .docker
            .list_containers(Some(opts))
            .await
            .context("listing managed containers for stats")?;

        let mut samples = Vec::new();
        for c in containers {
            let id = match c.id.as_deref() {
                Some(id) => id.to_string(),
                None => continue,
            };
            let labels = c.labels.clone().unwrap_or_default();

            // stream=false with one_shot=false makes the daemon populate precpu,
            // so a single read yields a valid CPU delta.
            let stat_opts = StatsOptions {
                stream: false,
                one_shot: false,
            };
            let mut stream = self.docker.stats(&id, Some(stat_opts));
            let stats = match stream.next().await {
                Some(Ok(s)) => s,
                _ => continue,
            };

            let cpu_percent = compute_cpu_percent(
                stats.precpu_stats.cpu_usage.total_usage,
                stats.cpu_stats.cpu_usage.total_usage,
                stats.precpu_stats.system_cpu_usage.unwrap_or(0),
                stats.cpu_stats.system_cpu_usage.unwrap_or(0),
                stats
                    .cpu_stats
                    .online_cpus
                    .filter(|n| *n > 0)
                    .or_else(|| {
                        stats
                            .cpu_stats
                            .cpu_usage
                            .percpu_usage
                            .as_ref()
                            .map(|v| v.len() as u64)
                    })
                    .unwrap_or(1),
            );

            let mem_used = stats.memory_stats.usage.unwrap_or(0);
            let mem_limit = stats.memory_stats.limit.unwrap_or(0);
            let mem_mb = mem_used as f64 / (1024.0 * 1024.0);
            let mem_percent = if mem_limit > 0 {
                (mem_used as f64 / mem_limit as f64) * 100.0
            } else {
                0.0
            };

            let (mut rx, mut tx) = (0u64, 0u64);
            if let Some(networks) = &stats.networks {
                for n in networks.values() {
                    rx = rx.saturating_add(n.rx_bytes);
                    tx = tx.saturating_add(n.tx_bytes);
                }
            }
            let disk_bytes = stats.storage_stats.read_size_bytes.unwrap_or(0)
                + stats.storage_stats.write_size_bytes.unwrap_or(0);

            samples.push(ContainerSample {
                labels,
                cpu_percent,
                mem_mb,
                mem_percent,
                net_rx_kb: rx as f64 / 1024.0,
                net_tx_kb: tx as f64 / 1024.0,
                disk_mb: disk_bytes as f64 / (1024.0 * 1024.0),
            });
        }
        Ok(samples)
    }
}

/// Docker's container CPU% formula: the container CPU-time delta over the system
/// CPU-time delta, scaled by the number of online CPUs. Returns `0.0` when the
/// system delta is non-positive (first sample / clock skew).
pub fn compute_cpu_percent(
    prev_total: u64,
    cur_total: u64,
    prev_system: u64,
    cur_system: u64,
    online_cpus: u64,
) -> f64 {
    let cpu_delta = cur_total.saturating_sub(prev_total) as f64;
    let system_delta = cur_system.saturating_sub(prev_system) as f64;
    if system_delta <= 0.0 || cpu_delta < 0.0 {
        return 0.0;
    }
    let cpus = online_cpus.max(1) as f64;
    ((cpu_delta / system_delta) * cpus * 100.0).clamp(0.0, cpus * 100.0)
}

/// Poll `http://127.0.0.1:{port}{path}` until the expected status is observed or
/// retries are exhausted. Returns `true` when healthy.
pub async fn run_healthcheck(
    host_port: u16,
    path: &str,
    expect_status: u16,
    retries: u32,
    interval_ms: u64,
    timeout_ms: u64,
) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let normalized = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("http://127.0.0.1:{host_port}{normalized}");
    // retries is the number of *additional* attempts after the first.
    for attempt in 0..=retries {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().as_u16() == expect_status {
                return true;
            }
        }
        if attempt < retries {
            tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
        }
    }
    false
}

/* --------------------------------- helpers --------------------------------- */

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn log_output_to_string(output: &LogOutput) -> String {
    match output {
        LogOutput::StdOut { message }
        | LogOutput::StdErr { message }
        | LogOutput::Console { message }
        | LogOutput::StdIn { message } => String::from_utf8_lossy(message).into_owned(),
    }
}

/// Allocate a free TCP port by binding to port 0 and reading the assigned port.
fn allocate_ephemeral_port() -> Result<u16> {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").context("allocating ephemeral host port")?;
    let port = listener.local_addr()?.port();
    Ok(port)
}

/// Split `repo/name:tag` into (`repo/name`, `tag`), defaulting to `latest`.
/// Handles registries with a port (`host:5000/img`) by only treating a colon in
/// the final path segment as a tag separator.
fn split_image_tag(image: &str) -> (String, String) {
    if let Some(idx) = image.rfind(':') {
        // Ensure the colon is after the last '/', otherwise it's a registry port.
        let after_slash = image[idx..].find('/').is_none();
        if after_slash {
            return (image[..idx].to_string(), image[idx + 1..].to_string());
        }
    }
    (image.to_string(), "latest".to_string())
}

/// Resolve and connect to the Engine API for the configured runtime.
///
/// Precedence: explicit `socket` override → `DOCKER_HOST` env → runtime default
/// (Docker's local socket/named pipe, or a discovered Podman socket).
fn connect_engine(runtime: ContainerRuntime, socket: Option<&str>) -> Result<Docker> {
    if let Some(s) = socket {
        return connect_url(s);
    }
    // An operator-set DOCKER_HOST applies to whichever runtime is configured.
    if std::env::var_os("DOCKER_HOST").is_some() {
        return Docker::connect_with_defaults().context("connecting via DOCKER_HOST");
    }
    match runtime {
        ContainerRuntime::Docker => {
            Docker::connect_with_local_defaults().context("connecting to the local Docker daemon")
        }
        ContainerRuntime::Podman => connect_podman(),
    }
}

/// Connect to an explicit socket path or URL (`unix://…`, absolute path, or a
/// `tcp://`/`http://` endpoint routed through bollard's defaults).
fn connect_url(s: &str) -> Result<Docker> {
    #[cfg(unix)]
    {
        let path = s.strip_prefix("unix://").unwrap_or(s);
        if s.starts_with("unix://") || s.starts_with('/') {
            return Docker::connect_with_unix(path, 120, bollard::API_DEFAULT_VERSION)
                .with_context(|| format!("connecting to socket {path}"));
        }
    }
    // Non-unix endpoints (tcp/http/npipe): let bollard parse it via DOCKER_HOST.
    std::env::set_var("DOCKER_HOST", s);
    Docker::connect_with_defaults().with_context(|| format!("connecting to {s}"))
}

/// Discover and connect to a Podman API socket when none was specified.
#[cfg(unix)]
fn connect_podman() -> Result<Docker> {
    let candidates = podman_socket_candidates();
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return Docker::connect_with_unix(path, 120, bollard::API_DEFAULT_VERSION)
                .with_context(|| format!("connecting to Podman socket {path}"));
        }
    }
    bail!(
        "no Podman API socket found (tried: {}). Start it with \
         `systemctl --user enable --now podman.socket` (rootless) or \
         `sudo systemctl enable --now podman.socket` (rootful), or set \
         engine_socket / DOCKER_HOST in the agent config.",
        candidates.join(", ")
    )
}

#[cfg(not(unix))]
fn connect_podman() -> Result<Docker> {
    // On non-Unix hosts Podman exposes its socket via `podman machine`, which
    // publishes DOCKER_HOST; fall back to bollard's defaults.
    Docker::connect_with_defaults()
        .context("connecting to Podman (set DOCKER_HOST, e.g. via `podman machine`)")
}

/// Default Podman socket locations, rootless (per-user) first.
#[cfg(unix)]
fn podman_socket_candidates() -> Vec<String> {
    let mut v = Vec::new();
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR") {
        v.push(format!("{}/podman/podman.sock", dir.to_string_lossy()));
    }
    v.push("/run/podman/podman.sock".to_string());
    v.push("/var/run/podman/podman.sock".to_string());
    v
}

/// Decode base64 `user:pass` into bollard credentials.
fn decode_registry_auth(auth: &str) -> Option<DockerCredentials> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(auth)
        .ok()?;
    let s = String::from_utf8(decoded).ok()?;
    let (user, pass) = s.split_once(':')?;
    Some(DockerCredentials {
        username: Some(user.to_string()),
        password: Some(pass.to_string()),
        ..Default::default()
    })
}

/// Inject a clone token into an HTTPS git URL as `https://x-access-token:TOKEN@host/...`.
fn inject_clone_token(repo_url: &str, token: Option<&str>) -> String {
    match token {
        Some(t) if repo_url.starts_with("https://") => {
            let rest = &repo_url["https://".len()..];
            format!("https://x-access-token:{t}@{rest}")
        }
        _ => repo_url.to_string(),
    }
}

/// The primary container port for a buildpack build (first mapping, else 3000).
fn default_port(spec: &DeployAppSpec) -> u16 {
    spec.ports.first().map(|p| p.container_port).unwrap_or(3000)
}

/// Generate a reasonable Dockerfile per framework for buildpack sources.
fn generate_dockerfile(
    framework: Framework,
    install: Option<&str>,
    build: Option<&str>,
    start: Option<&str>,
    port: u16,
) -> String {
    match framework {
        Framework::Nextjs => {
            let install = install.unwrap_or("npm ci");
            let build = build.unwrap_or("npm run build");
            let start = start.unwrap_or("npm run start");
            format!(
                "FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN {install}\nCOPY . .\nRUN {build}\nENV PORT={port}\nENV HOST=0.0.0.0\nEXPOSE {port}\nCMD {start}\n"
            )
        }
        Framework::Node => {
            let install = install.unwrap_or("npm ci --omit=dev");
            let build = build.map(|b| format!("RUN {b}\n")).unwrap_or_default();
            let start = start.unwrap_or("node index.js");
            format!(
                "FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN {install}\nCOPY . .\n{build}ENV PORT={port}\nEXPOSE {port}\nCMD {start}\n"
            )
        }
        Framework::Python => {
            let install = install.unwrap_or("pip install --no-cache-dir -r requirements.txt");
            let build = build.map(|b| format!("RUN {b}\n")).unwrap_or_default();
            let start = start.unwrap_or("python app.py");
            format!(
                "FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt ./\nRUN {install}\nCOPY . .\n{build}ENV PORT={port}\nEXPOSE {port}\nCMD {start}\n"
            )
        }
        Framework::Static => {
            // Build (if any) then serve the output with a tiny nginx image.
            let install = install.unwrap_or("npm ci");
            let build = build.unwrap_or("npm run build");
            format!(
                "FROM node:20-alpine AS build\nWORKDIR /app\nCOPY package*.json ./\nRUN {install}\nCOPY . .\nRUN {build}\n\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nEXPOSE {port}\n"
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_percent_matches_docker_formula() {
        // 50% of one core: cpu delta is half the system delta, 1 cpu.
        assert!((compute_cpu_percent(0, 500, 0, 1000, 1) - 50.0).abs() < 1e-9);
        // Same deltas across 4 cpus scales to 200%.
        assert!((compute_cpu_percent(0, 500, 0, 1000, 4) - 200.0).abs() < 1e-9);
    }

    #[test]
    fn cpu_percent_zero_when_no_system_delta() {
        // First sample (no prior system usage) or clock skew -> 0, never NaN/inf.
        assert_eq!(compute_cpu_percent(100, 200, 0, 0, 2), 0.0);
        assert_eq!(compute_cpu_percent(0, 100, 500, 500, 2), 0.0);
    }
}
