//! Typed HTTP client for the control-plane agent endpoints (all under `/v1`).
//!
//! * `POST /v1/agent/register`            — join with a one-time token (no auth).
//! * `POST /v1/agent/heartbeat`           — telemetry + desired-state (Bearer).
//! * `GET  /v1/agent/commands`            — long-poll for signed commands (Bearer).
//! * `POST /v1/agent/commands/:id/result` — report result/progress (Bearer).
//! * `POST /v1/agent/logs`                — batched build/runtime logs (Bearer).
//!
//! All authenticated calls send `Authorization: Bearer ysa_...`. Network-level
//! failures are retried with capped exponential backoff; HTTP 4xx are returned to
//! the caller (they indicate a contract/state problem, not a transient fault).

use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::{Client, StatusCode};
use serde_json::Value;

use crate::protocol::{
    CommandPollResponse, CommandResultBody, HeartbeatRequest, HeartbeatResponse, LogBatch,
    NodeRegisterRequest, NodeRegisterResponse,
};

/// Long-poll timeout for `GET /agent/commands` (`COMMAND_POLL_TIMEOUT_MS`), plus
/// headroom for the request itself.
const COMMAND_POLL_TIMEOUT: Duration = Duration::from_millis(25_000);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RETRIES: u32 = 5;

#[derive(Clone)]
pub struct ApiClient {
    http: Client,
    base: String,
    token: Option<String>,
}

impl ApiClient {
    /// Build a client rooted at `api_url`. `token` is the agent bearer token; it
    /// is `None` before registration.
    pub fn new(api_url: &str, token: Option<String>) -> Result<Self> {
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("yourstack-agent/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("building reqwest client")?;
        Ok(ApiClient {
            http,
            base: api_url.trim_end_matches('/').to_string(),
            token,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/v1{}", self.base, path)
    }

    fn bearer(&self) -> Result<&str> {
        self.token
            .as_deref()
            .ok_or_else(|| anyhow!("agent is not registered (no auth token)"))
    }

    /// Register this node with a one-time join token. Returns the credentials the
    /// caller must persist. Not retried on 4xx (an invalid/used token is fatal).
    pub async fn register(&self, req: &NodeRegisterRequest) -> Result<NodeRegisterResponse> {
        let resp = self
            .http
            .post(self.url("/agent/register"))
            .json(req)
            .send()
            .await
            .context("register request failed")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("register rejected ({status}): {body}");
        }
        resp.json::<NodeRegisterResponse>()
            .await
            .context("decoding register response")
    }

    /// Send a heartbeat with telemetry. Retried on transient network errors.
    pub async fn heartbeat(&self, req: &HeartbeatRequest) -> Result<HeartbeatResponse> {
        let token = self.bearer()?;
        let value = self
            .send_with_retry(
                "POST",
                "/agent/heartbeat",
                token,
                Some(req),
                REQUEST_TIMEOUT,
            )
            .await?;
        serde_json::from_value(value).context("decoding heartbeat response")
    }

    /// Long-poll for queued commands. Returns the raw JSON envelopes so the caller
    /// can verify signatures over the exact bytes received.
    pub async fn poll_commands(&self) -> Result<Vec<Value>> {
        let token = self.bearer()?;
        let value = self
            .send_with_retry::<()>("GET", "/agent/commands", token, None, COMMAND_POLL_TIMEOUT)
            .await?;
        let parsed: CommandPollResponse =
            serde_json::from_value(value).context("decoding command poll response")?;
        Ok(parsed.commands)
    }

    /// Report a command result. The `commandId` lives in the URL, not the body.
    pub async fn post_result(&self, command_id: &str, body: &CommandResultBody) -> Result<()> {
        let token = self.bearer()?;
        let path = format!("/agent/commands/{command_id}/result");
        self.send_with_retry("POST", &path, token, Some(body), REQUEST_TIMEOUT)
            .await
            .map(|_| ())
    }

    /// Ship a batch of log events.
    pub async fn post_logs(&self, batch: &LogBatch) -> Result<()> {
        let token = self.bearer()?;
        self.send_with_retry("POST", "/agent/logs", token, Some(batch), REQUEST_TIMEOUT)
            .await
            .map(|_| ())
    }

    /// Core request helper with capped exponential backoff. Retries on connection
    /// errors, timeouts, and 5xx; returns immediately on success and on 4xx.
    async fn send_with_retry<B: serde::Serialize>(
        &self,
        method: &str,
        path: &str,
        token: &str,
        body: Option<&B>,
        timeout: Duration,
    ) -> Result<Value> {
        let url = self.url(path);
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let mut builder = match method {
                "GET" => self.http.get(&url),
                "POST" => self.http.post(&url),
                other => bail!("unsupported method {other}"),
            }
            .bearer_auth(token)
            .timeout(timeout);
            if let Some(b) = body {
                builder = builder.json(b);
            }

            match builder.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        // Some endpoints return `{ok:true}` — tolerate empty bodies.
                        let text = resp.text().await.unwrap_or_default();
                        if text.is_empty() {
                            return Ok(Value::Null);
                        }
                        return serde_json::from_str(&text)
                            .with_context(|| format!("decoding response from {path}"));
                    }
                    if status.is_client_error() {
                        let body = resp.text().await.unwrap_or_default();
                        // 401/403/404 etc. are not transient — surface immediately.
                        bail!("{method} {path} failed ({status}): {body}");
                    }
                    // 5xx — retry.
                    if attempt > MAX_RETRIES {
                        bail!("{method} {path} failed after {attempt} attempts ({status})");
                    }
                    self.backoff(attempt, status).await;
                }
                Err(err) => {
                    if attempt > MAX_RETRIES {
                        return Err(anyhow!(err))
                            .with_context(|| format!("{method} {path} failed after retries"));
                    }
                    self.backoff(attempt, StatusCode::SERVICE_UNAVAILABLE).await;
                }
            }
        }
    }

    async fn backoff(&self, attempt: u32, status: StatusCode) {
        // 0.5s, 1s, 2s, 4s, 8s … capped at 15s.
        let base = 500u64.saturating_mul(1 << attempt.min(6));
        let delay = Duration::from_millis(base.min(15_000));
        tracing::warn!(attempt, %status, delay_ms = delay.as_millis() as u64, "retrying request after backoff");
        tokio::time::sleep(delay).await;
    }
}
