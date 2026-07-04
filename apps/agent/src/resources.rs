//! Managed-resource handlers (YourStack v2).
//!
//! Each public function drives one typed command — provisioning databases,
//! object storage, serverless functions, CI runners, and app autoscaling — via
//! the Docker Engine API (bollard). Like the rest of the agent there is no path
//! to run arbitrary shell from the control plane: only these fixed handlers run,
//! and the only in-container `sh -c` invocations are the fixed backup dumps
//! against a database's own credentials.
//!
//! All resources are tagged `io.yourstack.managed=true` plus a per-kind label
//! (`io.yourstack.database` / `.storage` / `.function` / `.runner` / `.app`) so
//! the metrics reporter and telemetry can map containers back to their id.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use base64::Engine as _;
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, LogOutput, LogsOptions,
    RemoveContainerOptions, StartContainerOptions, WaitContainerOptions,
};
use bollard::errors::Error as BollardError;
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::models::{
    ContainerSummary, HostConfig, PortBinding, RestartPolicy, RestartPolicyNameEnum,
};
use bollard::volume::CreateVolumeOptions;
use futures_util::StreamExt;
use serde_json::json;

use crate::docker::DockerClient;
use crate::protocol::{
    BackupDatabaseSpec, CommandOutput, DatabaseEngine, DeployFunctionSpec, DeregisterRunnerSpec,
    FunctionRuntime, FunctionSource, InvokeFunctionSpec, ProvisionDatabaseSpec,
    ProvisionStorageSpec, RegisterRunnerSpec, RemoveDatabaseSpec, RemoveFunctionSpec,
    RemoveStorageSpec, RunJobSpec, ScaleAppSpec, StopDatabaseSpec, LABEL_APP, LABEL_DATABASE,
    LABEL_FUNCTION, LABEL_JOB, LABEL_MANAGED, LABEL_RUNNER, LABEL_STORAGE,
    RUNNER_TOKEN_PLACEHOLDER,
};

/* ------------------------------ run primitive ------------------------------ */

/// Inputs for [`run_container`]. Ports are `(container_port, host_port)`.
struct RunOpts<'a> {
    name: &'a str,
    image: &'a str,
    env: Vec<String>,
    labels: HashMap<String, String>,
    cmd: Option<Vec<String>>,
    ports: Vec<(u16, u16)>,
    binds: Vec<String>,
    network: Option<String>,
    nano_cpus: Option<i64>,
    memory_bytes: Option<i64>,
    restart: bool,
}

/// Pull (best-effort), replace any same-named container, then create + start one
/// container with the given resource limits, labels, env, ports, and mounts.
async fn run_container(docker: &DockerClient, opts: RunOpts<'_>) -> Result<String> {
    let engine = docker.engine();

    // Ensure the image is present (idempotent; a failure here surfaces later on
    // create with a clearer "no such image" error).
    let _ = docker.ensure_image(opts.image).await;

    // Basic replace: remove any prior container with this name.
    let _ = engine
        .remove_container(
            opts.name,
            Some(RemoveContainerOptions {
                force: true,
                v: false,
                link: false,
            }),
        )
        .await;

    let mut port_bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
    let mut exposed_ports: HashMap<String, HashMap<(), ()>> = HashMap::new();
    for (container_port, host_port) in &opts.ports {
        let key = format!("{container_port}/tcp");
        exposed_ports.insert(key.clone(), HashMap::new());
        port_bindings.insert(
            key,
            Some(vec![PortBinding {
                host_ip: Some("0.0.0.0".to_string()),
                host_port: Some(host_port.to_string()),
            }]),
        );
    }

    let restart_policy = if opts.restart {
        Some(RestartPolicy {
            name: Some(RestartPolicyNameEnum::UNLESS_STOPPED),
            maximum_retry_count: None,
        })
    } else {
        None
    };

    let host_config = HostConfig {
        nano_cpus: opts.nano_cpus,
        memory: opts.memory_bytes,
        binds: if opts.binds.is_empty() {
            None
        } else {
            Some(opts.binds.clone())
        },
        port_bindings: if port_bindings.is_empty() {
            None
        } else {
            Some(port_bindings)
        },
        network_mode: opts.network.clone(),
        restart_policy,
        ..Default::default()
    };

    let config = Config {
        image: Some(opts.image.to_string()),
        env: if opts.env.is_empty() {
            None
        } else {
            Some(opts.env.clone())
        },
        cmd: opts.cmd.clone(),
        labels: Some(opts.labels.clone()),
        exposed_ports: if exposed_ports.is_empty() {
            None
        } else {
            Some(exposed_ports)
        },
        host_config: Some(host_config),
        ..Default::default()
    };

    let create = engine
        .create_container(
            Some(CreateContainerOptions {
                name: opts.name.to_string(),
                platform: None,
            }),
            config,
        )
        .await
        .with_context(|| format!("creating container {}", opts.name))?;

    engine
        .start_container(opts.name, None::<StartContainerOptions<String>>)
        .await
        .with_context(|| format!("starting container {}", opts.name))?;

    Ok(create.id)
}

/// Base label set marking a container as managed and tagging it with its kind.
fn managed_labels(kind_label: &str, id: &str) -> HashMap<String, String> {
    let mut labels = HashMap::new();
    labels.insert(LABEL_MANAGED.to_string(), "true".to_string());
    labels.insert(kind_label.to_string(), id.to_string());
    labels
}

/// Create a named volume (idempotent) labelled to its owning resource.
async fn ensure_volume(
    docker: &DockerClient,
    name: &str,
    kind_label: &str,
    owner_id: &str,
) -> Result<()> {
    let mut labels: HashMap<String, String> = HashMap::new();
    labels.insert(LABEL_MANAGED.to_string(), "true".to_string());
    labels.insert(kind_label.to_string(), owner_id.to_string());
    // The `local` driver does not enforce a byte quota; storage sizing is
    // recorded as a label and enforced at the platform layer.
    let opts = CreateVolumeOptions {
        name: name.to_string(),
        driver: "local".to_string(),
        driver_opts: HashMap::new(),
        labels,
    };
    docker
        .engine()
        .create_volume(opts)
        .await
        .with_context(|| format!("creating volume {name}"))?;
    Ok(())
}

async fn list_by_label(
    docker: &DockerClient,
    key: &str,
    value: &str,
) -> Result<Vec<ContainerSummary>> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    filters.insert("label".to_string(), vec![format!("{key}={value}")]);
    let opts = ListContainersOptions::<String> {
        all: true,
        filters,
        ..Default::default()
    };
    docker
        .engine()
        .list_containers(Some(opts))
        .await
        .context("listing containers by label")
}

/// Force-remove every container carrying `key=value`; returns the count removed.
async fn remove_by_label(docker: &DockerClient, key: &str, value: &str) -> Result<usize> {
    let list = list_by_label(docker, key, value).await?;
    let mut count = 0usize;
    for c in list {
        let name = c
            .names
            .as_ref()
            .and_then(|n| n.first())
            .map(|n| n.trim_start_matches('/').to_string());
        let target = name.or(c.id.clone());
        if let Some(t) = target {
            if docker.remove_container(&t, false).await.is_ok() {
                count += 1;
            }
        }
    }
    Ok(count)
}

/// Run a fixed command inside a container, capturing combined stdout+stderr and
/// the exit code. Used only for database backup dumps.
async fn exec_capture(
    docker: &DockerClient,
    container: &str,
    cmd: Vec<String>,
) -> Result<(Vec<u8>, i64)> {
    let engine = docker.engine();
    let exec = engine
        .create_exec(
            container,
            CreateExecOptions::<String> {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                cmd: Some(cmd),
                ..Default::default()
            },
        )
        .await
        .context("creating exec")?;

    let start = engine
        .start_exec(&exec.id, None::<bollard::exec::StartExecOptions>)
        .await
        .context("starting exec")?;

    let mut out: Vec<u8> = Vec::new();
    if let StartExecResults::Attached { mut output, .. } = start {
        while let Some(item) = output.next().await {
            if let Ok(msg) = item {
                let bytes = match msg {
                    LogOutput::StdOut { message }
                    | LogOutput::StdErr { message }
                    | LogOutput::Console { message }
                    | LogOutput::StdIn { message } => message,
                };
                out.extend_from_slice(&bytes);
            }
        }
    }

    let code = engine
        .inspect_exec(&exec.id)
        .await
        .ok()
        .and_then(|i| i.exit_code)
        .unwrap_or(0);
    Ok((out, code))
}

/* --------------------------------- databases ------------------------------- */

fn database_image(engine: DatabaseEngine, version: &str) -> String {
    match engine {
        DatabaseEngine::Postgres => format!("postgres:{version}"),
        DatabaseEngine::Mysql => format!("mysql:{version}"),
        DatabaseEngine::Redis => format!("redis:{version}"),
        DatabaseEngine::Mongodb => format!("mongo:{version}"),
    }
}

fn database_port(engine: DatabaseEngine) -> u16 {
    match engine {
        DatabaseEngine::Postgres => 5432,
        DatabaseEngine::Mysql => 3306,
        DatabaseEngine::Redis => 6379,
        DatabaseEngine::Mongodb => 27017,
    }
}

fn database_data_path(engine: DatabaseEngine) -> &'static str {
    match engine {
        DatabaseEngine::Postgres => "/var/lib/postgresql/data",
        DatabaseEngine::Mysql => "/var/lib/mysql",
        DatabaseEngine::Redis => "/data",
        DatabaseEngine::Mongodb => "/data/db",
    }
}

fn database_engine_name(engine: DatabaseEngine) -> &'static str {
    match engine {
        DatabaseEngine::Postgres => "postgres",
        DatabaseEngine::Mysql => "mysql",
        DatabaseEngine::Redis => "redis",
        DatabaseEngine::Mongodb => "mongodb",
    }
}

fn database_env(spec: &ProvisionDatabaseSpec) -> Vec<String> {
    match spec.engine {
        DatabaseEngine::Postgres => vec![
            format!("POSTGRES_PASSWORD={}", spec.password),
            format!("POSTGRES_USER={}", spec.username),
            format!("POSTGRES_DB={}", spec.db_name),
        ],
        DatabaseEngine::Mysql => {
            let mut env = vec![
                format!("MYSQL_ROOT_PASSWORD={}", spec.password),
                format!("MYSQL_DATABASE={}", spec.db_name),
            ];
            // MYSQL_USER may not be "root"; only add a non-root app user.
            if spec.username != "root" {
                env.push(format!("MYSQL_USER={}", spec.username));
                env.push(format!("MYSQL_PASSWORD={}", spec.password));
            }
            env
        }
        DatabaseEngine::Redis => vec![
            // Referenced by the backup exec; the running server auth comes from
            // the --requirepass flag in `database_cmd`.
            format!("REDIS_PASSWORD={}", spec.password),
        ],
        DatabaseEngine::Mongodb => vec![
            format!("MONGO_INITDB_ROOT_USERNAME={}", spec.username),
            format!("MONGO_INITDB_ROOT_PASSWORD={}", spec.password),
            format!("MONGO_INITDB_DATABASE={}", spec.db_name),
        ],
    }
}

fn database_cmd(spec: &ProvisionDatabaseSpec) -> Option<Vec<String>> {
    match spec.engine {
        DatabaseEngine::Redis => Some(vec![
            "redis-server".to_string(),
            "--requirepass".to_string(),
            spec.password.clone(),
            "--appendonly".to_string(),
            "yes".to_string(),
        ]),
        _ => None,
    }
}

pub async fn provision_database(
    docker: &DockerClient,
    spec: &ProvisionDatabaseSpec,
) -> Result<CommandOutput> {
    if let Some(net) = &spec.network_name {
        docker.ensure_network(net).await?;
    }

    let image = database_image(spec.engine, &spec.version);
    let volume_name = format!("{}-data", spec.container_name);
    ensure_volume(docker, &volume_name, LABEL_DATABASE, &spec.database_id).await?;

    let mut labels = managed_labels(LABEL_DATABASE, &spec.database_id);
    labels.insert(
        "io.yourstack.engine".to_string(),
        database_engine_name(spec.engine).to_string(),
    );
    labels.insert(
        "io.yourstack.storage_mb".to_string(),
        spec.storage_mb.to_string(),
    );

    let nano_cpus = (spec.resources.cpu * 1_000_000_000.0).round() as i64;
    let memory_bytes = spec.resources.memory_mb.saturating_mul(1024 * 1024);

    let id = run_container(
        docker,
        RunOpts {
            name: &spec.container_name,
            image: &image,
            env: database_env(spec),
            labels,
            cmd: database_cmd(spec),
            ports: vec![(database_port(spec.engine), spec.port)],
            binds: vec![format!("{volume_name}:{}", database_data_path(spec.engine))],
            network: spec.network_name.clone(),
            nano_cpus: Some(nano_cpus),
            memory_bytes: Some(memory_bytes),
            restart: true,
        },
    )
    .await?;

    Ok(CommandOutput {
        message: Some(format!(
            "provisioned {} database {} on :{}",
            database_engine_name(spec.engine),
            spec.database_id,
            spec.port
        )),
        container_id: Some(id),
        host_port: Some(spec.port as i64),
        ..Default::default()
    })
}

pub async fn stop_database(
    docker: &DockerClient,
    spec: &StopDatabaseSpec,
) -> Result<CommandOutput> {
    docker.stop_container(&spec.container_name, 10).await?;
    Ok(CommandOutput {
        message: Some(format!("stopped database {}", spec.database_id)),
        ..Default::default()
    })
}

pub async fn remove_database(
    docker: &DockerClient,
    spec: &RemoveDatabaseSpec,
) -> Result<CommandOutput> {
    docker
        .remove_container(&spec.container_name, spec.remove_volume)
        .await?;
    if spec.remove_volume {
        let volume_name = format!("{}-data", spec.container_name);
        let _ = docker.engine().remove_volume(&volume_name, None).await;
    }
    Ok(CommandOutput {
        message: Some(format!("removed database {}", spec.database_id)),
        ..Default::default()
    })
}

/// The fixed dump command for each engine, run inside the DB container against
/// its own env-provided credentials.
fn backup_command(engine: DatabaseEngine) -> Vec<String> {
    let script = match engine {
        DatabaseEngine::Postgres => {
            "pg_dump -U \"$POSTGRES_USER\" \"$POSTGRES_DB\""
        }
        DatabaseEngine::Mysql => {
            "exec mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --all-databases"
        }
        DatabaseEngine::Redis => {
            "redis-cli -a \"$REDIS_PASSWORD\" --no-auth-warning --rdb /tmp/yourstack-backup.rdb >/dev/null && cat /tmp/yourstack-backup.rdb"
        }
        DatabaseEngine::Mongodb => {
            "mongodump --username \"$MONGO_INITDB_ROOT_USERNAME\" --password \"$MONGO_INITDB_ROOT_PASSWORD\" --authenticationDatabase admin --archive"
        }
    };
    vec!["sh".to_string(), "-c".to_string(), script.to_string()]
}

pub async fn backup_database(
    docker: &DockerClient,
    spec: &BackupDatabaseSpec,
) -> Result<CommandOutput> {
    let (bytes, code) =
        exec_capture(docker, &spec.container_name, backup_command(spec.engine)).await?;
    if code != 0 {
        bail!(
            "backup of {} failed (exit {code}): {}",
            spec.database_id,
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(500)
                .collect::<String>()
        );
    }
    let mut extra: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    extra.insert("bytes".to_string(), json!(bytes.len()));
    if let Some(bucket) = &spec.bucket_id {
        extra.insert("bucketId".to_string(), json!(bucket));
    }
    Ok(CommandOutput {
        message: Some(format!(
            "backed up {} ({} bytes)",
            spec.database_id,
            bytes.len()
        )),
        extra: Some(extra),
        ..Default::default()
    })
}

/* ---------------------------------- storage -------------------------------- */

pub async fn provision_storage(
    docker: &DockerClient,
    spec: &ProvisionStorageSpec,
) -> Result<CommandOutput> {
    let volume_name = format!("{}-data", spec.container_name);
    ensure_volume(docker, &volume_name, LABEL_STORAGE, &spec.bucket_id).await?;

    let console_port = spec.console_port.unwrap_or(spec.port.saturating_add(1));

    let env = vec![
        format!("MINIO_ROOT_USER={}", spec.access_key),
        format!("MINIO_ROOT_PASSWORD={}", spec.secret_key),
    ];

    let mut labels = managed_labels(LABEL_STORAGE, &spec.bucket_id);
    labels.insert("io.yourstack.bucket".to_string(), spec.bucket_name.clone());
    labels.insert(
        "io.yourstack.storage_mb".to_string(),
        spec.quota_mb.to_string(),
    );
    labels.insert(
        "io.yourstack.public".to_string(),
        spec.is_public.to_string(),
    );

    let cmd = vec![
        "server".to_string(),
        "/data".to_string(),
        "--console-address".to_string(),
        format!(":{console_port}"),
    ];

    let id = run_container(
        docker,
        RunOpts {
            name: &spec.container_name,
            image: "minio/minio:latest",
            env,
            labels,
            cmd: Some(cmd),
            ports: vec![(9000, spec.port), (9001, console_port)],
            binds: vec![format!("{volume_name}:/data")],
            network: None,
            nano_cpus: None,
            memory_bytes: None,
            restart: true,
        },
    )
    .await?;

    let endpoint = format!("http://127.0.0.1:{}", spec.port);
    let mut extra: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    extra.insert("endpoint".to_string(), json!(endpoint));
    extra.insert(
        "consoleEndpoint".to_string(),
        json!(format!("http://127.0.0.1:{console_port}")),
    );
    extra.insert("bucket".to_string(), json!(spec.bucket_name));

    Ok(CommandOutput {
        message: Some(format!(
            "provisioned storage {} ({})",
            spec.bucket_name, endpoint
        )),
        container_id: Some(id),
        host_port: Some(spec.port as i64),
        extra: Some(extra),
        ..Default::default()
    })
}

pub async fn remove_storage(
    docker: &DockerClient,
    spec: &RemoveStorageSpec,
) -> Result<CommandOutput> {
    docker
        .remove_container(&spec.container_name, spec.remove_volume)
        .await?;
    if spec.remove_volume {
        let volume_name = format!("{}-data", spec.container_name);
        let _ = docker.engine().remove_volume(&volume_name, None).await;
    }
    Ok(CommandOutput {
        message: Some(format!("removed storage {}", spec.bucket_id)),
        ..Default::default()
    })
}

/* --------------------------------- functions ------------------------------- */

fn runtime_source_ext(rt: FunctionRuntime) -> &'static str {
    match rt {
        FunctionRuntime::Node20 => "js",
        FunctionRuntime::Python311 => "py",
        FunctionRuntime::Go122 => "go",
        FunctionRuntime::Bun1 => "ts",
    }
}

fn wrapper_filename(rt: FunctionRuntime) -> &'static str {
    match rt {
        FunctionRuntime::Node20 => "_yourstack_server.js",
        FunctionRuntime::Python311 => "_yourstack_server.py",
        FunctionRuntime::Go122 => "_yourstack_server.go",
        FunctionRuntime::Bun1 => "_yourstack_server.ts",
    }
}

/// Split `index.handler` into (`index`, `handler`); defaults the export to
/// `handler` when the spec omits it.
fn split_handler(handler: &str) -> (String, String) {
    match handler.rsplit_once('.') {
        Some((file, func)) if !file.is_empty() && !func.is_empty() => {
            (file.to_string(), func.to_string())
        }
        _ => (handler.to_string(), "handler".to_string()),
    }
}

const NODE_WRAPPER: &str = r#"const http = require('http');
const mod = require('./__FILE__');
const handler = mod['__FUNC__'] || mod.default || mod;
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const result = await handler(payload, {});
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result === undefined ? null : result));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String((err && err.stack) || err) }));
    }
  });
});
server.listen(Number(process.env.PORT || 8080), () => console.log('yourstack function listening'));
"#;

const PYTHON_WRAPPER: &str = r#"import os, json
from http.server import BaseHTTPRequestHandler, HTTPServer
import importlib

_mod = importlib.import_module("__FILE__")
_fn = getattr(_mod, "__FUNC__")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def do_POST(self):
        length = int(self.headers.get("content-length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
            result = _fn(payload, {})
            out = json.dumps(result).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)
        except Exception as exc:
            out = json.dumps({"error": str(exc)}).encode()
            self.send_response(500); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)

HTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
"#;

const GO_WRAPPER: &str = r#"package main

import (
	"encoding/json"
	"net/http"
	"os"
)

func yourstackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
		return
	}
	var payload map[string]interface{}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	result, err := Handler(payload)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("content-type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/", yourstackHandler)
	_ = http.ListenAndServe(":"+port, nil)
}
"#;

const BUN_WRAPPER: &str = r#"const mod: any = await import("./__FILE__");
const handler = mod["__FUNC__"] ?? mod.default ?? mod;
Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  async fetch(req) {
    if (req.method !== "POST") return new Response("ok");
    try {
      const payload = await req.json().catch(() => ({}));
      const result = await handler(payload, {});
      return Response.json(result ?? null);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
});
console.log("yourstack function listening");
"#;

/// Generate the per-runtime HTTP wrapper that adapts the user's handler.
fn function_wrapper(rt: FunctionRuntime, file: &str, func: &str) -> String {
    let template = match rt {
        FunctionRuntime::Node20 => NODE_WRAPPER,
        FunctionRuntime::Python311 => PYTHON_WRAPPER,
        FunctionRuntime::Go122 => GO_WRAPPER,
        FunctionRuntime::Bun1 => BUN_WRAPPER,
    };
    template.replace("__FILE__", file).replace("__FUNC__", func)
}

/// Generate the per-runtime Dockerfile that installs deps and runs the wrapper.
fn function_dockerfile(rt: FunctionRuntime, wrapper: &str, port: u16) -> String {
    let template = match rt {
        FunctionRuntime::Node20 => {
            "FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN if [ -f package.json ]; then npm install --omit=dev || npm install; fi\nENV PORT=__PORT__\nEXPOSE __PORT__\nCMD [\"node\", \"__WRAPPER__\"]\n"
        }
        FunctionRuntime::Python311 => {
            "FROM python:3.11-slim\nWORKDIR /app\nCOPY . .\nRUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi\nENV PORT=__PORT__\nEXPOSE __PORT__\nCMD [\"python\", \"__WRAPPER__\"]\n"
        }
        FunctionRuntime::Go122 => {
            "FROM golang:1.22-alpine\nWORKDIR /app\nCOPY . .\nRUN if [ ! -f go.mod ]; then go mod init yourstackfn; fi\nRUN go build -o /app/server .\nENV PORT=__PORT__\nEXPOSE __PORT__\nCMD [\"/app/server\"]\n"
        }
        FunctionRuntime::Bun1 => {
            "FROM oven/bun:1\nWORKDIR /app\nCOPY . .\nRUN if [ -f package.json ]; then bun install || true; fi\nENV PORT=__PORT__\nEXPOSE __PORT__\nCMD [\"bun\", \"__WRAPPER__\"]\n"
        }
    };
    template
        .replace("__WRAPPER__", wrapper)
        .replace("__PORT__", &port.to_string())
}

/// Materialize the function source into a build directory (inline file, extracted
/// bundle tarball, or git clone).
async fn prepare_function_source(
    docker: &DockerClient,
    spec: &DeployFunctionSpec,
    file: &str,
) -> Result<PathBuf> {
    match &spec.source {
        FunctionSource::Git {
            repo_url,
            git_ref,
            clone_token,
        } => {
            let mut logs = Vec::new();
            docker
                .clone_repo(
                    repo_url,
                    git_ref,
                    clone_token.as_deref(),
                    &spec.function_id,
                    &mut logs,
                )
                .await
        }
        FunctionSource::Inline { code } => {
            let dir = docker.data_dir().join("functions").join(&spec.function_id);
            let _ = tokio::fs::remove_dir_all(&dir).await;
            tokio::fs::create_dir_all(&dir)
                .await
                .context("creating function build dir")?;
            let ext = runtime_source_ext(spec.runtime);
            tokio::fs::write(dir.join(format!("{file}.{ext}")), code)
                .await
                .context("writing inline function source")?;
            Ok(dir)
        }
        FunctionSource::Bundle { tarball_base64 } => {
            let dir = docker.data_dir().join("functions").join(&spec.function_id);
            let _ = tokio::fs::remove_dir_all(&dir).await;
            tokio::fs::create_dir_all(&dir)
                .await
                .context("creating function build dir")?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(tarball_base64.trim())
                .context("decoding function bundle base64")?;
            let tar_path = dir.join("_bundle.tar.gz");
            tokio::fs::write(&tar_path, &bytes)
                .await
                .context("writing function bundle")?;
            let out = tokio::process::Command::new("tar")
                .arg("-xzf")
                .arg(&tar_path)
                .arg("-C")
                .arg(&dir)
                .output()
                .await
                .context("spawning tar to extract bundle")?;
            if !out.status.success() {
                bail!(
                    "extracting function bundle failed: {}",
                    String::from_utf8_lossy(&out.stderr)
                );
            }
            let _ = tokio::fs::remove_file(&tar_path).await;
            Ok(dir)
        }
    }
}

fn sanitize_tag(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "fn".to_string()
    } else {
        cleaned
    }
}

pub async fn deploy_function(
    docker: &DockerClient,
    spec: &DeployFunctionSpec,
) -> Result<CommandOutput> {
    let (file, func) = split_handler(&spec.handler);
    let build_dir = prepare_function_source(docker, spec, &file).await?;

    let wrapper_name = wrapper_filename(spec.runtime);
    tokio::fs::write(
        build_dir.join(wrapper_name),
        function_wrapper(spec.runtime, &file, &func),
    )
    .await
    .context("writing function wrapper")?;

    let dockerfile = function_dockerfile(spec.runtime, wrapper_name, spec.port);
    let dockerfile_path = build_dir.join("Dockerfile.yourstack");
    tokio::fs::write(&dockerfile_path, dockerfile)
        .await
        .context("writing function Dockerfile")?;

    let tag = format!("yourstack-fn-{}:latest", sanitize_tag(&spec.function_id));
    docker
        .docker_build(&build_dir, Some(&dockerfile_path), &tag)
        .await?;

    // Run at least one warm instance so the function is immediately invokable.
    let instances = spec.min_instances.max(1);
    let memory_bytes = spec.memory_mb.saturating_mul(1024 * 1024);

    let mut first_id = String::new();
    for i in 0..instances {
        let name = if i == 0 {
            spec.container_name.clone()
        } else {
            format!("{}-{}", spec.container_name, i)
        };
        // Only the primary instance publishes the host port; warm spares are
        // reachable on the internal network.
        let ports = if i == 0 {
            vec![(spec.port, spec.port)]
        } else {
            vec![]
        };
        let mut labels = managed_labels(LABEL_FUNCTION, &spec.function_id);
        labels.insert("io.yourstack.function.name".to_string(), spec.name.clone());
        if i > 0 {
            labels.insert("io.yourstack.instance".to_string(), i.to_string());
        }
        let env: Vec<String> = spec
            .env
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .chain(std::iter::once(format!("PORT={}", spec.port)))
            .collect();

        let id = run_container(
            docker,
            RunOpts {
                name: &name,
                image: &tag,
                env,
                labels,
                cmd: None,
                ports,
                binds: vec![],
                network: None,
                nano_cpus: None,
                memory_bytes: Some(memory_bytes),
                restart: true,
            },
        )
        .await?;
        if i == 0 {
            first_id = id;
        }
    }

    let url = format!("http://127.0.0.1:{}", spec.port);
    let mut extra: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    extra.insert("url".to_string(), json!(url));
    extra.insert("instances".to_string(), json!(instances));

    Ok(CommandOutput {
        message: Some(format!(
            "deployed function {} ({} instance(s)) at {}",
            spec.name, instances, url
        )),
        container_id: Some(first_id),
        host_port: Some(spec.port as i64),
        extra: Some(extra),
        ..Default::default()
    })
}

/// Find the first published host port for a container.
async fn published_host_port(docker: &DockerClient, name: &str) -> Result<u16> {
    let info = docker
        .engine()
        .inspect_container(name, None)
        .await
        .with_context(|| format!("inspecting {name}"))?;
    let ports = info
        .network_settings
        .and_then(|n| n.ports)
        .ok_or_else(|| anyhow!("container {name} has no network settings"))?;
    for bindings in ports.into_values().flatten() {
        if let Some(binding) = bindings.first() {
            if let Some(hp) = &binding.host_port {
                if let Ok(p) = hp.parse::<u16>() {
                    return Ok(p);
                }
            }
        }
    }
    bail!("container {name} has no published host port")
}

pub async fn invoke_function(
    docker: &DockerClient,
    spec: &InvokeFunctionSpec,
) -> Result<CommandOutput> {
    let host_port = published_host_port(docker, &spec.container_name).await?;
    let url = format!("http://127.0.0.1:{host_port}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .context("building function HTTP client")?;

    let started = Instant::now();
    let resp = client
        .post(&url)
        .json(&spec.payload)
        .send()
        .await
        .with_context(|| format!("invoking function {}", spec.function_id))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    let duration_ms = started.elapsed().as_millis() as i64;

    let mut extra: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    extra.insert("status".to_string(), json!(status));
    extra.insert(
        "response".to_string(),
        json!(body.chars().take(4000).collect::<String>()),
    );

    Ok(CommandOutput {
        message: Some(format!(
            "invoked {} -> {} in {}ms",
            spec.function_id, status, duration_ms
        )),
        exit_code: Some(status as i64),
        duration_ms: Some(duration_ms),
        extra: Some(extra),
        ..Default::default()
    })
}

pub async fn remove_function(
    docker: &DockerClient,
    spec: &RemoveFunctionSpec,
) -> Result<CommandOutput> {
    // Remove every instance labelled to this function, plus the named primary.
    let mut removed = remove_by_label(docker, LABEL_FUNCTION, &spec.function_id).await?;
    if docker
        .remove_container(&spec.container_name, false)
        .await
        .is_ok()
    {
        removed += 1;
    }
    Ok(CommandOutput {
        message: Some(format!(
            "removed function {} ({} container(s))",
            spec.function_id, removed
        )),
        ..Default::default()
    })
}

/* ---------------------------------- runners -------------------------------- */

pub async fn register_runner(
    docker: &DockerClient,
    spec: &RegisterRunnerSpec,
) -> Result<CommandOutput> {
    if spec.registration_token == RUNNER_TOKEN_PLACEHOLDER {
        bail!(
            "runner {} not registered: registrationToken is the placeholder '{}'. Connect the GitHub App / mint a real self-hosted runner token first.",
            spec.runner_id,
            RUNNER_TOKEN_PLACEHOLDER
        );
    }

    let labels_csv = spec.labels.join(",");
    let mut env = vec![
        format!("RUNNER_NAME={}", spec.runner_id),
        format!("RUNNER_TOKEN={}", spec.registration_token),
        format!("REPO_URL={}", spec.github_url),
        "RUNNER_SCOPE=repo".to_string(),
        format!("LABELS={labels_csv}"),
        "DISABLE_AUTO_UPDATE=true".to_string(),
    ];
    if spec.ephemeral {
        env.push("EPHEMERAL=true".to_string());
    }

    let mut labels = managed_labels(LABEL_RUNNER, &spec.runner_id);
    labels.insert("io.yourstack.runner.pool".to_string(), spec.pool_id.clone());

    let id = run_container(
        docker,
        RunOpts {
            name: &spec.container_name,
            image: "myoung34/github-runner:latest",
            env,
            labels,
            cmd: None,
            ports: vec![],
            binds: vec![],
            network: None,
            nano_cpus: None,
            memory_bytes: None,
            // Ephemeral runners exit after one job and must not be restarted.
            restart: !spec.ephemeral,
        },
    )
    .await?;

    Ok(CommandOutput {
        message: Some(format!(
            "registered runner {} (pool {}, ephemeral={})",
            spec.runner_id, spec.pool_id, spec.ephemeral
        )),
        container_id: Some(id),
        ..Default::default()
    })
}

pub async fn deregister_runner(
    docker: &DockerClient,
    spec: &DeregisterRunnerSpec,
) -> Result<CommandOutput> {
    docker.remove_container(&spec.container_name, false).await?;
    Ok(CommandOutput {
        message: Some(format!("deregistered runner {}", spec.runner_id)),
        ..Default::default()
    })
}

/* -------------------------------- autoscaling ------------------------------ */

pub async fn scale_app(docker: &DockerClient, spec: &ScaleAppSpec) -> Result<CommandOutput> {
    let existing = list_by_label(docker, LABEL_APP, &spec.app_id).await?;

    // Derive the image and network from any existing app container.
    let template_image = existing.iter().find_map(|c| c.image.clone());
    let template_network = existing.iter().find_map(|c| {
        c.network_settings
            .as_ref()
            .and_then(|ns| ns.networks.as_ref())
            .and_then(|n| n.keys().find(|k| k.as_str() != "bridge").cloned())
    });

    let existing_names: Vec<String> = existing
        .iter()
        .flat_map(|c| c.names.clone().unwrap_or_default())
        .map(|n| n.trim_start_matches('/').to_string())
        .collect();

    let replicas = spec.replicas.max(0);
    let desired: Vec<String> = (0..replicas)
        .map(|i| format!("{}-{}", spec.container_name, i))
        .collect();
    let prefix = format!("{}-", spec.container_name);

    // Remove replicas beyond the desired set.
    for name in &existing_names {
        if name.starts_with(&prefix) && !desired.contains(name) {
            let _ = docker.remove_container(name, false).await;
        }
    }

    // Create any missing desired replicas.
    if !desired.is_empty() {
        let image = template_image.ok_or_else(|| {
            anyhow!(
                "cannot scale app {}: no existing container to derive the image from — deploy it first",
                spec.app_id
            )
        })?;
        let nano_cpus = (spec.resources.cpu * 1_000_000_000.0).round() as i64;
        let memory_bytes = spec.resources.memory_mb.saturating_mul(1024 * 1024);

        for name in &desired {
            if existing_names.contains(name) {
                continue;
            }
            let mut labels = managed_labels(LABEL_APP, &spec.app_id);
            labels.insert("io.yourstack.replica".to_string(), name.clone());
            run_container(
                docker,
                RunOpts {
                    name,
                    image: &image,
                    env: vec![],
                    labels,
                    cmd: None,
                    ports: vec![],
                    binds: vec![],
                    network: template_network.clone(),
                    nano_cpus: Some(nano_cpus),
                    memory_bytes: Some(memory_bytes),
                    restart: true,
                },
            )
            .await?;
        }
    }

    let mut extra: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    extra.insert("replicas".to_string(), json!(replicas));

    Ok(CommandOutput {
        message: Some(format!(
            "scaled app {} to {} replica(s)",
            spec.app_id, replicas
        )),
        extra: Some(extra),
        ..Default::default()
    })
}

/* ------------------------------ scheduled jobs ----------------------------- */

/// Keep only the last `n` non-empty lines of `logs`, joined by newlines. Pure.
fn last_n_lines(logs: &str, n: usize) -> String {
    let lines: Vec<&str> = logs.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Collect the tail of a container's combined stdout+stderr (best-effort).
async fn job_log_tail(docker: &DockerClient, container: &str, lines: usize) -> String {
    let opts = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        follow: false,
        tail: lines.to_string(),
        timestamps: false,
        ..Default::default()
    };
    let mut stream = docker.engine().logs(container, Some(opts));
    let mut out = String::new();
    while let Some(item) = stream.next().await {
        if let Ok(msg) = item {
            let bytes = match msg {
                LogOutput::StdOut { message }
                | LogOutput::StdErr { message }
                | LogOutput::Console { message }
                | LogOutput::StdIn { message } => message,
            };
            out.push_str(&String::from_utf8_lossy(&bytes));
        }
    }
    last_n_lines(&out, lines)
}

/// Append the log tail to a message when non-empty (`": <tail>"`).
fn with_tail(tail: &str) -> String {
    if tail.is_empty() {
        String::new()
    } else {
        format!(": {tail}")
    }
}

/// Run a container to completion (cron job / one-off task). Pulls the image
/// (optionally authenticated), starts a one-shot container with the given argv,
/// env, resource limits, and job labels, waits for it to exit under `timeoutMs`
/// (killing it if it overruns), captures the exit code, duration, and a short log
/// tail, then removes the container. This never runs arbitrary shell: only the
/// specified image plus its optional argv are executed.
pub async fn run_job(docker: &DockerClient, spec: &RunJobSpec) -> Result<CommandOutput> {
    // Pull first so a private-registry image surfaces a clear auth error.
    docker
        .ensure_image_auth(&spec.image, spec.registry_auth.as_deref())
        .await
        .with_context(|| format!("pulling job image {}", spec.image))?;

    let env: Vec<String> = spec.env.iter().map(|(k, v)| format!("{k}={v}")).collect();

    let mut labels = managed_labels(LABEL_JOB, &spec.job_id);
    labels.insert("io.yourstack.job.run".to_string(), spec.run_id.clone());

    let nano_cpus = (spec.resources.cpu * 1_000_000_000.0).round() as i64;
    let memory_bytes = spec.resources.memory_mb.saturating_mul(1024 * 1024);

    // One-shot: a finished job container must not be restarted.
    let container_id = run_container(
        docker,
        RunOpts {
            name: &spec.container_name,
            image: &spec.image,
            env,
            labels,
            cmd: spec.command.clone(),
            ports: vec![],
            binds: vec![],
            network: None,
            nano_cpus: Some(nano_cpus),
            memory_bytes: Some(memory_bytes),
            restart: false,
        },
    )
    .await?;

    // Wait for exit, bounded by the job's own timeout. bollard maps a non-zero
    // exit to Err(DockerContainerWaitError { code }), so both arms yield a code.
    let started = Instant::now();
    let wait_opts = WaitContainerOptions {
        condition: "not-running".to_string(),
    };
    let mut wait = docker
        .engine()
        .wait_container(&spec.container_name, Some(wait_opts));
    let timeout = Duration::from_millis(spec.timeout_ms.max(1) as u64);

    let exit_code: i64 = match tokio::time::timeout(timeout, wait.next()).await {
        Err(_elapsed) => {
            // Overran its timeout: kill + remove so no job container is orphaned.
            let tail = job_log_tail(docker, &spec.container_name, 20).await;
            let _ = docker.remove_container(&spec.container_name, false).await;
            bail!(
                "job {} timed out after {}ms (container killed){}",
                spec.job_id,
                spec.timeout_ms,
                with_tail(&tail)
            );
        }
        Ok(Some(Ok(resp))) => resp.status_code,
        Ok(Some(Err(BollardError::DockerContainerWaitError { code, .. }))) => code,
        Ok(Some(Err(e))) => {
            let _ = docker.remove_container(&spec.container_name, false).await;
            return Err(anyhow!(e)).with_context(|| format!("waiting for job {}", spec.job_id));
        }
        Ok(None) => 0, // stream ended without a response; treat as a clean exit
    };

    let duration_ms = started.elapsed().as_millis() as i64;
    let tail = job_log_tail(docker, &spec.container_name, 20).await;
    let _ = docker.remove_container(&spec.container_name, false).await;

    if exit_code != 0 {
        bail!(
            "job {} exited {}{}",
            spec.job_id,
            exit_code,
            with_tail(&tail)
        );
    }

    Ok(CommandOutput {
        message: Some(if tail.is_empty() {
            format!("job {} completed (exit 0)", spec.job_id)
        } else {
            tail
        }),
        container_id: Some(container_id),
        exit_code: Some(exit_code),
        duration_ms: Some(duration_ms),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_n_lines_keeps_tail_and_drops_blanks() {
        assert_eq!(last_n_lines("a\nb\nc\nd", 2), "c\nd");
        // Fewer lines than requested returns them all.
        assert_eq!(last_n_lines("only", 5), "only");
        // Blank lines are filtered out before taking the tail.
        assert_eq!(last_n_lines("a\n\n  \nb\n", 2), "a\nb");
        assert_eq!(last_n_lines("", 3), "");
    }

    #[test]
    fn with_tail_prefixes_only_when_present() {
        assert_eq!(with_tail(""), "");
        assert_eq!(with_tail("boom"), ": boom");
    }

    #[test]
    fn split_handler_parses_file_and_export() {
        assert_eq!(
            split_handler("index.handler"),
            ("index".to_string(), "handler".to_string())
        );
        assert_eq!(
            split_handler("app.main"),
            ("app".to_string(), "main".to_string())
        );
        // No dot -> default export name.
        assert_eq!(
            split_handler("main"),
            ("main".to_string(), "handler".to_string())
        );
    }

    #[test]
    fn dockerfile_per_runtime_uses_expected_base_image_and_port() {
        let node = function_dockerfile(FunctionRuntime::Node20, "_yourstack_server.js", 8080);
        assert!(node.contains("FROM node:20-alpine"));
        assert!(node.contains("ENV PORT=8080"));
        assert!(node.contains("_yourstack_server.js"));

        let py = function_dockerfile(FunctionRuntime::Python311, "_yourstack_server.py", 9000);
        assert!(py.contains("FROM python:3.11-slim"));
        assert!(py.contains("EXPOSE 9000"));

        let go = function_dockerfile(FunctionRuntime::Go122, "_yourstack_server.go", 3000);
        assert!(go.contains("FROM golang:1.22-alpine"));
        assert!(go.contains("go build -o /app/server"));

        let bun = function_dockerfile(FunctionRuntime::Bun1, "_yourstack_server.ts", 5000);
        assert!(bun.contains("FROM oven/bun:1"));
        assert!(bun.contains("\"bun\", \"_yourstack_server.ts\""));
    }

    #[test]
    fn wrapper_substitutes_handler_file_and_func() {
        let w = function_wrapper(FunctionRuntime::Node20, "index", "handler");
        assert!(w.contains("require('./index')"));
        assert!(w.contains("mod['handler']"));
        assert!(!w.contains("__FILE__"));
        assert!(!w.contains("__FUNC__"));
    }
}
