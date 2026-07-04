//! System telemetry collection via `sysinfo`, plus Docker facts via bollard.
//!
//! Two shapes are produced: the reduced [`RegisterTelemetry`] sent once at join,
//! and the full [`NodeTelemetry`] sent on every heartbeat. CPU usage requires two
//! samples separated by `MINIMUM_CPU_UPDATE_INTERVAL`, so [`Collector`] keeps a
//! long-lived `System` and refreshes it between calls.

use std::time::Duration;

use sysinfo::{Disks, System, MINIMUM_CPU_UPDATE_INTERVAL};

use crate::docker::DockerClient;
use crate::protocol::{NodeTelemetry, RegisterTelemetry, AGENT_PROTOCOL_VERSION};

const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const BYTES_PER_MB: u64 = 1024 * 1024;

/// Node-level resource metrics sampled for the metrics reporter.
pub struct NodeMetrics {
    pub cpu_percent: f64,
    pub mem_mb: f64,
    pub mem_percent: f64,
    pub disk_mb: f64,
}

/// Holds long-lived probes so repeated telemetry reads are cheap and CPU deltas
/// are meaningful.
pub struct Collector {
    sys: System,
}

impl Collector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Collector { sys }
    }

    /// Reduced telemetry for the registration request.
    pub async fn register_telemetry(&mut self, docker: Option<&DockerClient>) -> RegisterTelemetry {
        let (mem_total_mb, _mem_used_mb) = self.memory_mb();
        let (disk_total_mb, _disk_used_mb) = disk_mb();
        RegisterTelemetry {
            agent_version: AGENT_VERSION.to_string(),
            protocol_version: AGENT_PROTOCOL_VERSION,
            os: os_name(),
            arch: arch(),
            cpu_cores: self.cpu_cores(),
            memory_total_mb: mem_total_mb,
            disk_total_mb,
            docker_version: docker_version(docker).await,
            public_ip: None,
        }
    }

    /// Full telemetry for a heartbeat, including live CPU usage and the set of
    /// agent-managed containers currently running.
    pub async fn heartbeat_telemetry(&mut self, docker: Option<&DockerClient>) -> NodeTelemetry {
        let cpu_usage = self.cpu_usage_percent().await;
        let (mem_total_mb, mem_used_mb) = self.memory_mb();
        let (disk_total_mb, disk_used_mb) = disk_mb();
        let running_apps = match docker {
            Some(d) => d.list_managed_apps().await.unwrap_or_default(),
            None => Vec::new(),
        };
        NodeTelemetry {
            agent_version: AGENT_VERSION.to_string(),
            protocol_version: AGENT_PROTOCOL_VERSION,
            os: os_name(),
            arch: arch(),
            kernel: System::kernel_version(),
            docker_version: docker_version(docker).await,
            cpu_cores: self.cpu_cores(),
            cpu_usage_percent: cpu_usage,
            memory_total_mb: mem_total_mb,
            memory_used_mb: mem_used_mb,
            disk_total_mb,
            disk_used_mb,
            public_ip: None,
            uptime_seconds: Some(System::uptime() as i64),
            running_apps,
        }
    }

    /// Node-level resource metrics for the metrics reporter (distinct from the
    /// heartbeat's telemetry snapshot; returns percentages and MB directly).
    pub async fn node_metrics(&mut self) -> NodeMetrics {
        let cpu_percent = self.cpu_usage_percent().await;
        let (mem_total_mb, mem_used_mb) = self.memory_mb();
        let (_disk_total_mb, disk_used_mb) = disk_mb();
        let mem_percent = if mem_total_mb > 0 {
            (mem_used_mb as f64 / mem_total_mb as f64) * 100.0
        } else {
            0.0
        };
        NodeMetrics {
            cpu_percent,
            mem_mb: mem_used_mb as f64,
            mem_percent,
            disk_mb: disk_used_mb as f64,
        }
    }

    fn cpu_cores(&self) -> i64 {
        self.sys.cpus().len() as i64
    }

    /// Global CPU usage percent, sampled across `MINIMUM_CPU_UPDATE_INTERVAL`.
    async fn cpu_usage_percent(&mut self) -> f64 {
        self.sys.refresh_cpu_usage();
        tokio::time::sleep(MINIMUM_CPU_UPDATE_INTERVAL + Duration::from_millis(10)).await;
        self.sys.refresh_cpu_usage();
        (self.sys.global_cpu_usage() as f64).clamp(0.0, 100.0)
    }

    fn memory_mb(&mut self) -> (i64, i64) {
        self.sys.refresh_memory();
        let total = (self.sys.total_memory() / BYTES_PER_MB) as i64;
        let used = (self.sys.used_memory() / BYTES_PER_MB) as i64;
        (total, used)
    }
}

impl Default for Collector {
    fn default() -> Self {
        Self::new()
    }
}

fn os_name() -> String {
    System::name().unwrap_or_else(|| std::env::consts::OS.to_string())
}

fn arch() -> String {
    // std constant is reliable and version-agnostic across sysinfo releases.
    std::env::consts::ARCH.to_string()
}

/// Aggregate disk figures. We report the largest single filesystem (typically the
/// root/data volume) rather than summing, which would double-count bind mounts.
fn disk_mb() -> (i64, i64) {
    let disks = Disks::new_with_refreshed_list();
    let mut best_total: u64 = 0;
    let mut best_used: u64 = 0;
    for disk in disks.list() {
        let total = disk.total_space();
        if total > best_total {
            best_total = total;
            best_used = total.saturating_sub(disk.available_space());
        }
    }
    (
        (best_total / BYTES_PER_MB) as i64,
        (best_used / BYTES_PER_MB) as i64,
    )
}

async fn docker_version(docker: Option<&DockerClient>) -> Option<String> {
    match docker {
        Some(d) => d.version().await.ok().flatten(),
        None => None,
    }
}
