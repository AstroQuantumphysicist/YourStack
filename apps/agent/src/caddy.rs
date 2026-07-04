//! Caddy reverse-proxy management for `CONFIGURE_DOMAIN`.
//!
//! Two strategies are supported, tried in order:
//!  1. The **Caddy admin API** at `http://localhost:2019` (assumed default). We
//!     PUT a route into the running server config so changes apply with zero
//!     downtime and automatic HTTPS via Let's Encrypt.
//!  2. If the admin API is unreachable, we fall back to writing a Caddyfile
//!     fragment under `{data_dir}/caddy/` and reloading Caddy via the CLI
//!     (`caddy reload`). Operators can also `import` this directory.
//!
//! Caddy itself must already be installed on the node (documented in the README);
//! the agent never installs system packages.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde_json::json;

use crate::protocol::DomainConfig;

const CADDY_ADMIN: &str = "http://localhost:2019";

pub struct CaddyManager {
    data_dir: PathBuf,
    http: reqwest::Client,
}

impl CaddyManager {
    pub fn new(data_dir: PathBuf) -> Self {
        CaddyManager {
            data_dir,
            http: reqwest::Client::new(),
        }
    }

    /// Route `domain` -> `127.0.0.1:{host_port}` with automatic HTTPS. Returns a
    /// human-readable description of what was applied.
    pub async fn configure_domain(&self, domain: &DomainConfig, host_port: u16) -> Result<String> {
        match self.apply_via_admin_api(domain, host_port).await {
            Ok(msg) => Ok(msg),
            Err(admin_err) => {
                tracing::warn!(error = %admin_err, "Caddy admin API unavailable; writing Caddyfile fragment");
                self.write_caddyfile_fragment(domain, host_port).await
            }
        }
    }

    /// Push a route to the Caddy admin API. Uses the `@id` mechanism so repeated
    /// configuration for the same domain replaces the previous route instead of
    /// accumulating duplicates.
    async fn apply_via_admin_api(&self, domain: &DomainConfig, host_port: u16) -> Result<String> {
        let route_id = format!("yourstack-{}", sanitize(&domain.domain));
        let upstream = format!("127.0.0.1:{host_port}");

        // Delete any existing route with this id (ignore 404/errors), then append.
        let del_url = format!("{CADDY_ADMIN}/id/{route_id}");
        let _ = self.http.delete(&del_url).send().await;

        let route = json!({
            "@id": route_id,
            "match": [{ "host": [domain.domain] }],
            "handle": [{
                "handler": "reverse_proxy",
                "upstreams": [{ "dial": upstream }]
            }],
            "terminal": true
        });

        // Append to the default HTTP server's routes. This assumes a server named
        // `srv0` (Caddy's default when adapting a Caddyfile). If the running
        // config differs, the fallback path writes a Caddyfile instead.
        let routes_url = format!("{CADDY_ADMIN}/config/apps/http/servers/srv0/routes/...");
        let resp = self
            .http
            .post(&routes_url)
            .json(&json!([route]))
            .send()
            .await
            .context("posting route to Caddy admin API")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Caddy admin API rejected route ({status}): {body}");
        }
        Ok(format!(
            "configured {} -> {} via Caddy admin API (autoHttps={})",
            domain.domain, upstream, domain.auto_https
        ))
    }

    /// Write a per-domain Caddyfile fragment and attempt `caddy reload`.
    async fn write_caddyfile_fragment(
        &self,
        domain: &DomainConfig,
        host_port: u16,
    ) -> Result<String> {
        let dir = self.data_dir.join("caddy");
        tokio::fs::create_dir_all(&dir)
            .await
            .context("creating caddy config dir")?;
        let file = dir.join(format!("{}.caddy", sanitize(&domain.domain)));

        // `autoHttps=false` -> bind :80 and disable TLS for this site.
        let contents = if domain.auto_https {
            format!(
                "{} {{\n\treverse_proxy 127.0.0.1:{}\n}}\n",
                domain.domain, host_port
            )
        } else {
            format!(
                "http://{} {{\n\treverse_proxy 127.0.0.1:{}\n}}\n",
                domain.domain, host_port
            )
        };
        tokio::fs::write(&file, contents)
            .await
            .context("writing caddy fragment")?;

        // Best-effort reload; failure is non-fatal (operator may reload manually).
        let reload = tokio::process::Command::new("caddy")
            .arg("reload")
            .arg("--config")
            .arg(&file)
            .arg("--adapter")
            .arg("caddyfile")
            .output()
            .await;
        let reloaded = matches!(&reload, Ok(o) if o.status.success());

        Ok(format!(
            "wrote Caddyfile fragment {} for {} -> 127.0.0.1:{} (reloaded={})",
            file.display(),
            domain.domain,
            host_port,
            reloaded
        ))
    }
}

/// Make a domain safe for use as a filename / config id.
fn sanitize(domain: &str) -> String {
    domain
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}
