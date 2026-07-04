//! Windows Service integration.
//!
//! When installed as a service (see `scripts/install.ps1`), the SCM launches the
//! agent with the hidden `run-service` subcommand. This module registers the
//! service control handler, reports Running/Stopped status, and runs the daemon
//! on a dedicated Tokio runtime until the SCM sends Stop/Shutdown.
//!
//! This file is only compiled on Windows.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::Notify;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

use crate::config::{default_config_path, Config};

/// The Windows service name (matches the installer and self-update restart).
pub const SERVICE_NAME: &str = "yourstack-agent";

define_windows_service!(ffi_service_main, service_main);

/// Hand control to the SCM dispatcher. Returns once the service stops. Called
/// from `main` for the `run-service` subcommand.
pub fn run() -> Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .context("starting the Windows service dispatcher")?;
    Ok(())
}

/// SCM entry point. Any error is logged to the agent log; there is no console.
fn service_main(arguments: Vec<OsString>) {
    let config_path = parse_config_arg(&arguments);
    if let Err(e) = run_service(config_path) {
        tracing::error!(error = %e, "windows service exited with error");
    }
}

/// Extract `--config <path>` from the service's binPath arguments, falling back
/// to the platform default. The SCM forwards the registered binPath args here.
fn parse_config_arg(arguments: &[OsString]) -> PathBuf {
    let mut it = arguments.iter();
    while let Some(arg) = it.next() {
        if arg == "--config" {
            if let Some(path) = it.next() {
                return PathBuf::from(path);
            }
        }
    }
    default_config_path()
}

fn run_service(config_path: PathBuf) -> Result<()> {
    // The control handler notifies this when the SCM asks us to stop.
    let shutdown = Arc::new(Notify::new());
    let handler_shutdown = shutdown.clone();

    let status_handle =
        service_control_handler::register(SERVICE_NAME, move |control| match control {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                handler_shutdown.notify_waiters();
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        })
        .context("registering the service control handler")?;

    let set_state = |state: ServiceState, accept: ServiceControlAccept| ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: accept,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::from_secs(10),
        process_id: None,
    };

    status_handle
        .set_service_status(set_state(
            ServiceState::Running,
            ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
        ))
        .context("reporting Running status")?;

    // Own Tokio runtime (the process was not started via #[tokio::main]).
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building the service Tokio runtime")?;

    let result = runtime.block_on(async {
        let config = Config::load(&config_path)
            .with_context(|| format!("loading service config at {}", config_path.display()))?;
        crate::daemon::run_with_shutdown(config, shutdown).await
    });

    // Always report Stopped, even if the daemon returned an error, so the SCM
    // does not leave the service wedged in Running/StopPending.
    status_handle
        .set_service_status(set_state(
            ServiceState::Stopped,
            ServiceControlAccept::empty(),
        ))
        .context("reporting Stopped status")?;

    result
}
