//! Wire protocol types mirroring `packages/shared/src/schemas/*.ts`.
//!
//! These structs are the Rust source of truth for the control-plane contract.
//! Field names, casing, and the discriminated-union tags (`type` / `kind`) match
//! the Zod schemas exactly so that JSON produced by the API deserializes here and
//! JSON produced here validates on the API. Do not rename fields without changing
//! the shared package in lockstep.

// These types mirror the fixed control-plane wire contract. Some fields and enum
// variants are part of the protocol for round-tripping/forward-compat and are not
// all read by the agent today, so dead-code analysis is intentionally relaxed.
#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Protocol version negotiated with the control plane (`AGENT_PROTOCOL_VERSION`).
pub const AGENT_PROTOCOL_VERSION: i64 = 1;

/// Docker label namespace used to mark and identify agent-managed resources.
pub const LABEL_MANAGED: &str = "io.yourstack.managed";
pub const LABEL_APP: &str = "io.yourstack.app";
pub const LABEL_DEPLOYMENT: &str = "io.yourstack.deployment";
pub const LABEL_DATABASE: &str = "io.yourstack.database";
pub const LABEL_STORAGE: &str = "io.yourstack.storage";
pub const LABEL_FUNCTION: &str = "io.yourstack.function";
pub const LABEL_RUNNER: &str = "io.yourstack.runner";

/* ------------------------------- registration ------------------------------ */

/// `nodeRegisterSchema` — the one-time join request. `telemetry` is the reduced
/// registration telemetry (a subset of the heartbeat telemetry).
#[derive(Debug, Clone, Serialize)]
pub struct NodeRegisterRequest {
    #[serde(rename = "joinToken")]
    pub join_token: String,
    pub name: String,
    pub telemetry: RegisterTelemetry,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegisterTelemetry {
    #[serde(rename = "agentVersion")]
    pub agent_version: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i64,
    pub os: String,
    pub arch: String,
    #[serde(rename = "cpuCores")]
    pub cpu_cores: i64,
    #[serde(rename = "memoryTotalMb")]
    pub memory_total_mb: i64,
    #[serde(rename = "diskTotalMb")]
    pub disk_total_mb: i64,
    #[serde(rename = "dockerVersion", skip_serializing_if = "Option::is_none")]
    pub docker_version: Option<String>,
    #[serde(rename = "publicIp", skip_serializing_if = "Option::is_none")]
    pub public_ip: Option<String>,
}

/// `nodeRegisterResponseSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct NodeRegisterResponse {
    #[serde(rename = "nodeId")]
    pub node_id: String,
    #[serde(rename = "agentToken")]
    pub agent_token: String,
    #[serde(rename = "commandVerifyKey")]
    pub command_verify_key: String,
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: i64,
}

/* --------------------------------- telemetry ------------------------------- */

/// `nodeTelemetrySchema` — full telemetry reported on every heartbeat.
#[derive(Debug, Clone, Serialize)]
pub struct NodeTelemetry {
    #[serde(rename = "agentVersion")]
    pub agent_version: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: i64,
    pub os: String,
    pub arch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kernel: Option<String>,
    #[serde(rename = "dockerVersion", skip_serializing_if = "Option::is_none")]
    pub docker_version: Option<String>,
    #[serde(rename = "cpuCores")]
    pub cpu_cores: i64,
    #[serde(rename = "cpuUsagePercent")]
    pub cpu_usage_percent: f64,
    #[serde(rename = "memoryTotalMb")]
    pub memory_total_mb: i64,
    #[serde(rename = "memoryUsedMb")]
    pub memory_used_mb: i64,
    #[serde(rename = "diskTotalMb")]
    pub disk_total_mb: i64,
    #[serde(rename = "diskUsedMb")]
    pub disk_used_mb: i64,
    #[serde(rename = "publicIp", skip_serializing_if = "Option::is_none")]
    pub public_ip: Option<String>,
    #[serde(rename = "uptimeSeconds", skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<i64>,
    #[serde(rename = "runningApps")]
    pub running_apps: Vec<String>,
}

/// `heartbeatRequestSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct HeartbeatRequest {
    pub telemetry: NodeTelemetry,
}

/// `heartbeatResponseSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct HeartbeatResponse {
    pub ok: bool,
    #[serde(rename = "desiredStatus")]
    pub desired_status: DesiredStatus,
    #[serde(rename = "hasPendingCommands")]
    pub has_pending_commands: bool,
    #[serde(rename = "serverTime")]
    pub server_time: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesiredStatus {
    Online,
    Draining,
}

/* ---------------------------------- commands ------------------------------- */

/// `nodeCommandSchema` — the signed envelope delivered to the agent.
#[derive(Debug, Clone, Deserialize)]
pub struct NodeCommand {
    pub id: String,
    #[serde(rename = "nodeId")]
    pub node_id: String,
    pub payload: CommandPayload,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: i64,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    pub signature: String,
}

/// `commandPollResponseSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct CommandPollResponse {
    pub commands: Vec<serde_json::Value>,
}

/// `commandPayloadSchema` — discriminated union tagged by `type`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum CommandPayload {
    #[serde(rename = "DEPLOY_APP")]
    DeployApp { spec: DeployAppSpec },
    #[serde(rename = "STOP_APP")]
    StopApp { spec: StopAppSpec },
    #[serde(rename = "RESTART_APP")]
    RestartApp { spec: RestartAppSpec },
    #[serde(rename = "REMOVE_APP")]
    RemoveApp { spec: RemoveAppSpec },
    #[serde(rename = "STREAM_LOGS")]
    StreamLogs { spec: StreamLogsSpec },
    #[serde(rename = "HEALTH_CHECK")]
    HealthCheck { spec: HealthCheckSpec },
    #[serde(rename = "CONFIGURE_DOMAIN")]
    ConfigureDomain { spec: ConfigureDomainSpec },
    #[serde(rename = "ROLLBACK_DEPLOYMENT")]
    RollbackDeployment { spec: RollbackDeploymentSpec },
    // ---- v2 managed resources ----
    #[serde(rename = "PROVISION_DATABASE")]
    ProvisionDatabase { spec: ProvisionDatabaseSpec },
    #[serde(rename = "STOP_DATABASE")]
    StopDatabase { spec: StopDatabaseSpec },
    #[serde(rename = "REMOVE_DATABASE")]
    RemoveDatabase { spec: RemoveDatabaseSpec },
    #[serde(rename = "BACKUP_DATABASE")]
    BackupDatabase { spec: BackupDatabaseSpec },
    #[serde(rename = "PROVISION_STORAGE")]
    ProvisionStorage { spec: ProvisionStorageSpec },
    #[serde(rename = "REMOVE_STORAGE")]
    RemoveStorage { spec: RemoveStorageSpec },
    #[serde(rename = "DEPLOY_FUNCTION")]
    DeployFunction { spec: DeployFunctionSpec },
    #[serde(rename = "INVOKE_FUNCTION")]
    InvokeFunction { spec: InvokeFunctionSpec },
    #[serde(rename = "REMOVE_FUNCTION")]
    RemoveFunction { spec: RemoveFunctionSpec },
    #[serde(rename = "REGISTER_RUNNER")]
    RegisterRunner { spec: RegisterRunnerSpec },
    #[serde(rename = "DEREGISTER_RUNNER")]
    DeregisterRunner { spec: DeregisterRunnerSpec },
    #[serde(rename = "SCALE_APP")]
    ScaleApp { spec: ScaleAppSpec },
}

impl CommandPayload {
    /// Human-readable command type (matches the TS `CommandType` string).
    pub fn type_name(&self) -> &'static str {
        match self {
            CommandPayload::DeployApp { .. } => "DEPLOY_APP",
            CommandPayload::StopApp { .. } => "STOP_APP",
            CommandPayload::RestartApp { .. } => "RESTART_APP",
            CommandPayload::RemoveApp { .. } => "REMOVE_APP",
            CommandPayload::StreamLogs { .. } => "STREAM_LOGS",
            CommandPayload::HealthCheck { .. } => "HEALTH_CHECK",
            CommandPayload::ConfigureDomain { .. } => "CONFIGURE_DOMAIN",
            CommandPayload::RollbackDeployment { .. } => "ROLLBACK_DEPLOYMENT",
            CommandPayload::ProvisionDatabase { .. } => "PROVISION_DATABASE",
            CommandPayload::StopDatabase { .. } => "STOP_DATABASE",
            CommandPayload::RemoveDatabase { .. } => "REMOVE_DATABASE",
            CommandPayload::BackupDatabase { .. } => "BACKUP_DATABASE",
            CommandPayload::ProvisionStorage { .. } => "PROVISION_STORAGE",
            CommandPayload::RemoveStorage { .. } => "REMOVE_STORAGE",
            CommandPayload::DeployFunction { .. } => "DEPLOY_FUNCTION",
            CommandPayload::InvokeFunction { .. } => "INVOKE_FUNCTION",
            CommandPayload::RemoveFunction { .. } => "REMOVE_FUNCTION",
            CommandPayload::RegisterRunner { .. } => "REGISTER_RUNNER",
            CommandPayload::DeregisterRunner { .. } => "DEREGISTER_RUNNER",
            CommandPayload::ScaleApp { .. } => "SCALE_APP",
        }
    }
}

/* ------------------------------- deploy spec ------------------------------- */

fn default_context_path() -> String {
    ".".to_string()
}
fn default_dockerfile() -> String {
    "Dockerfile".to_string()
}
fn default_protocol() -> String {
    "tcp".to_string()
}
fn default_strategy() -> String {
    "basic_replace".to_string()
}

/// `deploySourceSchema` — discriminated union tagged by `kind`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DeploySource {
    Image {
        image: String,
        #[serde(rename = "registryAuth", default)]
        registry_auth: Option<String>,
    },
    Git {
        #[serde(rename = "repoUrl")]
        repo_url: String,
        #[serde(rename = "ref")]
        git_ref: String,
        #[serde(rename = "contextPath", default = "default_context_path")]
        context_path: String,
        #[serde(default = "default_dockerfile")]
        dockerfile: String,
        #[serde(rename = "cloneToken", default)]
        clone_token: Option<String>,
    },
    Buildpack {
        #[serde(rename = "repoUrl")]
        repo_url: String,
        #[serde(rename = "ref")]
        git_ref: String,
        framework: Framework,
        #[serde(rename = "installCommand", default)]
        install_command: Option<String>,
        #[serde(rename = "buildCommand", default)]
        build_command: Option<String>,
        #[serde(rename = "startCommand", default)]
        start_command: Option<String>,
        #[serde(rename = "cloneToken", default)]
        clone_token: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    Nextjs,
    Node,
    Python,
    Static,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PortMapping {
    #[serde(rename = "containerPort")]
    pub container_port: u16,
    #[serde(rename = "hostPort", default)]
    pub host_port: Option<u16>,
    #[serde(default = "default_protocol")]
    pub protocol: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ResourceSpec {
    #[serde(default = "default_cpu")]
    pub cpu: f64,
    #[serde(rename = "memoryMb", default = "default_memory_mb")]
    pub memory_mb: i64,
}
fn default_cpu() -> f64 {
    0.5
}
fn default_memory_mb() -> i64 {
    512
}

#[derive(Debug, Clone, Deserialize)]
pub struct HealthcheckSpec {
    #[serde(default = "default_hc_path")]
    pub path: String,
    pub port: u16,
    #[serde(rename = "timeoutMs", default = "default_hc_timeout")]
    pub timeout_ms: u64,
    #[serde(default = "default_hc_retries")]
    pub retries: u32,
    #[serde(rename = "intervalMs", default = "default_hc_interval")]
    pub interval_ms: u64,
    #[serde(rename = "expectStatus", default = "default_hc_status")]
    pub expect_status: u16,
}
fn default_hc_path() -> String {
    "/".to_string()
}
fn default_hc_timeout() -> u64 {
    10_000
}
fn default_hc_retries() -> u32 {
    5
}
fn default_hc_interval() -> u64 {
    3_000
}
fn default_hc_status() -> u16 {
    200
}

#[derive(Debug, Clone, Deserialize)]
pub struct DomainConfig {
    pub domain: String,
    #[serde(rename = "autoHttps", default = "default_true")]
    pub auto_https: bool,
    #[serde(rename = "targetPort")]
    pub target_port: u16,
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeployAppSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "deploymentId")]
    pub deployment_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "imageTag")]
    pub image_tag: String,
    pub source: DeploySource,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub ports: Vec<PortMapping>,
    pub resources: ResourceSpec,
    #[serde(default)]
    pub healthcheck: Option<HealthcheckSpec>,
    #[serde(default)]
    pub domain: Option<DomainConfig>,
    #[serde(default = "default_strategy")]
    pub strategy: String,
    #[serde(rename = "networkName", default)]
    pub network_name: Option<String>,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StopAppSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "timeoutSeconds", default = "default_stop_timeout")]
    pub timeout_seconds: i64,
}
fn default_stop_timeout() -> i64 {
    10
}

#[derive(Debug, Clone, Deserialize)]
pub struct RestartAppSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveAppSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "removeVolumes", default)]
    pub remove_volumes: bool,
    #[serde(rename = "removeImages", default)]
    pub remove_images: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StreamLogsSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(default = "default_tail")]
    pub tail: u64,
    #[serde(default = "default_true")]
    pub follow: bool,
    #[serde(rename = "sinceSeconds", default)]
    pub since_seconds: Option<i64>,
}
fn default_tail() -> u64 {
    200
}

#[derive(Debug, Clone, Deserialize)]
pub struct HealthCheckSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    pub healthcheck: HealthcheckSpec,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigureDomainSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    pub domain: DomainConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RollbackDeploymentSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "targetDeploymentId")]
    pub target_deployment_id: String,
    pub spec: DeployAppSpec,
}

/* --------------------------- v2 resource specs ----------------------------- */

/// `databaseEngineSchema` — `postgres` | `mysql` | `redis` | `mongodb`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseEngine {
    Postgres,
    Mysql,
    Redis,
    Mongodb,
}

fn default_db_version() -> String {
    "16".to_string()
}
fn default_db_name() -> String {
    "app".to_string()
}
fn default_db_username() -> String {
    "yourstack".to_string()
}
fn default_db_storage_mb() -> i64 {
    10_240
}

/// `provisionDatabaseSpecSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct ProvisionDatabaseSpec {
    #[serde(rename = "databaseId")]
    pub database_id: String,
    pub engine: DatabaseEngine,
    #[serde(default = "default_db_version")]
    pub version: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "dbName", default = "default_db_name")]
    pub db_name: String,
    #[serde(default = "default_db_username")]
    pub username: String,
    pub password: String,
    #[serde(rename = "storageMb", default = "default_db_storage_mb")]
    pub storage_mb: i64,
    pub resources: ResourceSpec,
    pub port: u16,
    #[serde(rename = "networkName", default)]
    pub network_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StopDatabaseSpec {
    #[serde(rename = "databaseId")]
    pub database_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveDatabaseSpec {
    #[serde(rename = "databaseId")]
    pub database_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "removeVolume", default)]
    pub remove_volume: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackupDatabaseSpec {
    #[serde(rename = "databaseId")]
    pub database_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    pub engine: DatabaseEngine,
    #[serde(rename = "bucketId", default)]
    pub bucket_id: Option<String>,
}

fn default_quota_mb() -> i64 {
    51_200
}

/// `provisionStorageSpecSchema` — MinIO (S3-compatible) object storage.
#[derive(Debug, Clone, Deserialize)]
pub struct ProvisionStorageSpec {
    #[serde(rename = "bucketId")]
    pub bucket_id: String,
    #[serde(rename = "bucketName")]
    pub bucket_name: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "accessKey")]
    pub access_key: String,
    #[serde(rename = "secretKey")]
    pub secret_key: String,
    #[serde(rename = "quotaMb", default = "default_quota_mb")]
    pub quota_mb: i64,
    #[serde(rename = "isPublic", default)]
    pub is_public: bool,
    pub port: u16,
    #[serde(rename = "consolePort", default)]
    pub console_port: Option<u16>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveStorageSpec {
    #[serde(rename = "bucketId")]
    pub bucket_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(rename = "removeVolume", default)]
    pub remove_volume: bool,
}

/// `functionRuntimeSchema` — supported function runtimes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FunctionRuntime {
    Node20,
    Python311,
    Go122,
    Bun1,
}

/// The function source bundle, discriminated by `kind`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FunctionSource {
    Inline {
        code: String,
    },
    Bundle {
        #[serde(rename = "tarballBase64")]
        tarball_base64: String,
    },
    Git {
        #[serde(rename = "repoUrl")]
        repo_url: String,
        #[serde(rename = "ref")]
        git_ref: String,
        #[serde(rename = "cloneToken", default)]
        clone_token: Option<String>,
    },
}

fn default_handler() -> String {
    "index.handler".to_string()
}
fn default_fn_memory_mb() -> i64 {
    256
}
fn default_fn_timeout_ms() -> i64 {
    30_000
}
fn default_min_instances() -> i64 {
    0
}

/// `deployFunctionSpecSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct DeployFunctionSpec {
    #[serde(rename = "functionId")]
    pub function_id: String,
    pub name: String,
    pub runtime: FunctionRuntime,
    #[serde(default = "default_handler")]
    pub handler: String,
    pub source: FunctionSource,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(rename = "memoryMb", default = "default_fn_memory_mb")]
    pub memory_mb: i64,
    #[serde(rename = "timeoutMs", default = "default_fn_timeout_ms")]
    pub timeout_ms: i64,
    #[serde(rename = "containerName")]
    pub container_name: String,
    pub port: u16,
    #[serde(rename = "minInstances", default = "default_min_instances")]
    pub min_instances: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InvokeFunctionSpec {
    #[serde(rename = "functionId")]
    pub function_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoveFunctionSpec {
    #[serde(rename = "functionId")]
    pub function_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
}

fn default_runner_labels() -> Vec<String> {
    vec!["yourstack".to_string(), "self-hosted".to_string()]
}
fn default_ephemeral() -> bool {
    true
}

/// The documented placeholder token: a runner spec carrying this token has not
/// been connected to GitHub yet, so registration is expected to fail cleanly.
pub const RUNNER_TOKEN_PLACEHOLDER: &str = "PLACEHOLDER_CONNECT_GITHUB";

/// `registerRunnerSpecSchema`.
#[derive(Debug, Clone, Deserialize)]
pub struct RegisterRunnerSpec {
    #[serde(rename = "runnerId")]
    pub runner_id: String,
    #[serde(rename = "poolId")]
    pub pool_id: String,
    #[serde(rename = "registrationToken")]
    pub registration_token: String,
    #[serde(rename = "githubUrl")]
    pub github_url: String,
    #[serde(default = "default_runner_labels")]
    pub labels: Vec<String>,
    #[serde(rename = "containerName")]
    pub container_name: String,
    #[serde(default = "default_ephemeral")]
    pub ephemeral: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeregisterRunnerSpec {
    #[serde(rename = "runnerId")]
    pub runner_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
}

/// `scaleAppSpecSchema` — reconcile N replica containers for an app.
#[derive(Debug, Clone, Deserialize)]
pub struct ScaleAppSpec {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "containerName")]
    pub container_name: String,
    pub replicas: i64,
    pub resources: ResourceSpec,
}

/* ---------------------------------- results -------------------------------- */

/// The status transitions a command can report (`commandResultSchema.status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Accepted,
    Running,
    Succeeded,
    Failed,
    TimedOut,
}

/// `commandResultSchema.output` — free-form structured output.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CommandOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(rename = "containerId", skip_serializing_if = "Option::is_none")]
    pub container_id: Option<String>,
    #[serde(rename = "imageDigest", skip_serializing_if = "Option::is_none")]
    pub image_digest: Option<String>,
    #[serde(rename = "hostPort", skip_serializing_if = "Option::is_none")]
    pub host_port: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub healthy: Option<bool>,
    #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(rename = "durationMs", skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<BTreeMap<String, serde_json::Value>>,
}

/// Body posted to `POST /agent/commands/:id/result` (the `commandId` is in the
/// URL and therefore omitted from the body, matching the API's `.omit`).
#[derive(Debug, Clone, Serialize)]
pub struct CommandResultBody {
    pub status: CommandStatus,
    pub output: CommandOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/* ------------------------------------ logs --------------------------------- */

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Build,
    Runtime,
    System,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogSeverity {
    Debug,
    Info,
    Warn,
    Error,
}

/// `logEventSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    #[serde(rename = "appId")]
    pub app_id: String,
    #[serde(rename = "deploymentId", skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(rename = "nodeId", skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub stream: LogStream,
    pub severity: LogSeverity,
    pub message: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<BTreeMap<String, serde_json::Value>>,
}

/// `logBatchSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct LogBatch {
    #[serde(rename = "commandId", skip_serializing_if = "Option::is_none")]
    pub command_id: Option<String>,
    pub events: Vec<LogEvent>,
}

/* ---------------------------------- metrics -------------------------------- */

/// `metricPointSchema.scope`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricScope {
    App,
    Node,
    Database,
    Function,
}

/// `metricPointSchema.kind` — the sampled quantity. Serializes to the exact
/// snake_case strings the API's `z.enum` accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricKind {
    CpuPercent,
    MemMb,
    MemPercent,
    Rps,
    LatencyMs,
    NetRxKb,
    NetTxKb,
    DiskMb,
    Replicas,
}

/// `metricPointSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct MetricPoint {
    pub scope: MetricScope,
    #[serde(rename = "targetId")]
    pub target_id: String,
    pub kind: MetricKind,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance: Option<String>,
    pub timestamp: String,
}

/// `metricBatchSchema`.
#[derive(Debug, Clone, Serialize)]
pub struct MetricBatch {
    #[serde(rename = "nodeId", skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    pub points: Vec<MetricPoint>,
}
