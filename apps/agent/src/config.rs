//! Agent configuration persisted to `agent.toml`.
//!
//! On Linux the canonical path is `/etc/noderail/agent.toml` (written by the
//! install script and owned by the `noderail` user). Everywhere else — and in
//! `dev` mode — the agent uses `./agent.toml` in the working directory so it is
//! trivial to run without root.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Location of the on-disk config. The daemon reads it at startup; `register`
/// writes it after a successful join.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Base URL of the control-plane API, e.g. `https://api.noderail.dev`.
    pub api_url: String,
    /// Node id assigned at registration (empty until registered).
    #[serde(default)]
    pub node_id: String,
    /// Long-lived agent auth token (`nra_...`). Empty until registered.
    #[serde(default)]
    pub agent_token: String,
    /// Hex HMAC key used to verify command signatures. Empty until registered.
    #[serde(default)]
    pub command_verify_key: String,
    /// Optional region label.
    #[serde(default)]
    pub region: Option<String>,
    /// Free-form labels applied to this node.
    #[serde(default)]
    pub labels: std::collections::BTreeMap<String, String>,
    /// Working directory for clones, build contexts, and generated Caddyfiles.
    #[serde(default = "default_data_dir")]
    pub data_dir: String,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            api_url: "http://localhost:4000".to_string(),
            node_id: String::new(),
            agent_token: String::new(),
            command_verify_key: String::new(),
            region: None,
            labels: Default::default(),
            data_dir: default_data_dir(),
        }
    }
}

fn default_data_dir() -> String {
    if cfg!(target_os = "linux") {
        "/var/lib/noderail".to_string()
    } else {
        "./data".to_string()
    }
}

impl Config {
    /// Whether the agent has completed registration and can authenticate.
    pub fn is_registered(&self) -> bool {
        !self.node_id.is_empty()
            && !self.agent_token.is_empty()
            && !self.command_verify_key.is_empty()
    }

    /// Load config from `path`.
    pub fn load(path: &Path) -> Result<Config> {
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("reading config at {}", path.display()))?;
        let cfg: Config = toml::from_str(&text)
            .with_context(|| format!("parsing TOML config at {}", path.display()))?;
        Ok(cfg)
    }

    /// Persist config to `path`, creating parent directories as needed. On Unix
    /// the file is written with `0600` permissions because it holds the agent
    /// token and HMAC key.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("creating config dir {}", parent.display()))?;
            }
        }
        let text = toml::to_string_pretty(self).context("serializing config to TOML")?;
        std::fs::write(path, text)
            .with_context(|| format!("writing config to {}", path.display()))?;
        restrict_permissions(path);
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o600);
        let _ = std::fs::set_permissions(path, perms);
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {
    // No-op on non-Unix platforms; ACLs are managed by the installer/OS.
}

/// Resolve the default config path for the current platform.
pub fn default_config_path() -> PathBuf {
    if cfg!(target_os = "linux") {
        PathBuf::from("/etc/noderail/agent.toml")
    } else {
        PathBuf::from("./agent.toml")
    }
}

/// The path used by `dev` mode — always a local file so no root is required.
pub fn dev_config_path() -> PathBuf {
    PathBuf::from("./agent.toml")
}
