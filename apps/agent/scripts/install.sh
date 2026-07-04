#!/bin/sh
# NodeRail agent installer.
#
# Idempotent install of the noderail-agent binary, a dedicated system user, the
# on-disk config, and the systemd unit. Re-running it upgrades the binary and
# re-applies configuration without duplicating state.
#
# Required environment:
#   NODERAIL_API_URL     Base URL of the control-plane API.
#   NODERAIL_JOIN_TOKEN  One-time join token (nrj_...) from the dashboard/CLI.
# Optional environment:
#   NODERAIL_NODE_NAME   Node display name (default: the machine hostname).
#   NODERAIL_REGION      Region label.
#   NODERAIL_BINARY_URL  URL to download the prebuilt binary from. If unset, the
#                        script expects ./noderail-agent next to this script or an
#                        already-installed binary on PATH.
set -eu

# ---- config -----------------------------------------------------------------
PREFIX="/usr/local/bin"
BIN_PATH="${PREFIX}/noderail-agent"
CONFIG_DIR="/etc/noderail"
CONFIG_PATH="${CONFIG_DIR}/agent.toml"
DATA_DIR="/var/lib/noderail"
SERVICE_NAME="noderail-agent"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_USER="noderail"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "must run as root (try: sudo -E $0)"
    exit 1
  fi
}

require_env() {
  : "${NODERAIL_API_URL:?set NODERAIL_API_URL}"
  : "${NODERAIL_JOIN_TOKEN:?set NODERAIL_JOIN_TOKEN}"
}

require_root
require_env

NODE_NAME="${NODERAIL_NODE_NAME:-$(hostname)}"

# ---- 1. system user ---------------------------------------------------------
if id "${AGENT_USER}" >/dev/null 2>&1; then
  log "user ${AGENT_USER} already exists"
else
  log "creating system user ${AGENT_USER}"
  useradd --system --no-create-home --shell /usr/sbin/nologin "${AGENT_USER}"
fi

# Grant Docker socket access if the docker group exists.
if getent group docker >/dev/null 2>&1; then
  log "adding ${AGENT_USER} to docker group"
  usermod -aG docker "${AGENT_USER}"
else
  err "docker group not found — install Docker so the agent can manage containers"
fi

# ---- 2. binary --------------------------------------------------------------
install_binary() {
  if [ -n "${NODERAIL_BINARY_URL:-}" ]; then
    log "downloading binary from ${NODERAIL_BINARY_URL}"
    tmp="$(mktemp)"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "${NODERAIL_BINARY_URL}" -o "${tmp}"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "${tmp}" "${NODERAIL_BINARY_URL}"
    else
      err "need curl or wget to download the binary"
      exit 1
    fi
    install -m 0755 "${tmp}" "${BIN_PATH}"
    rm -f "${tmp}"
  elif [ -f "${SCRIPT_DIR}/noderail-agent" ]; then
    log "installing bundled binary"
    install -m 0755 "${SCRIPT_DIR}/noderail-agent" "${BIN_PATH}"
  elif [ -f "${BIN_PATH}" ]; then
    log "reusing existing binary at ${BIN_PATH}"
  else
    err "no binary found: set NODERAIL_BINARY_URL or place noderail-agent next to this script"
    exit 1
  fi
}
install_binary

# ---- 3. directories & config ------------------------------------------------
log "ensuring config and data directories"
mkdir -p "${CONFIG_DIR}" "${DATA_DIR}"
chown "${AGENT_USER}:${AGENT_USER}" "${DATA_DIR}"
chmod 0750 "${DATA_DIR}"

if [ ! -f "${CONFIG_PATH}" ]; then
  log "writing initial config to ${CONFIG_PATH}"
  cat > "${CONFIG_PATH}" <<EOF
api_url = "${NODERAIL_API_URL}"
node_id = ""
agent_token = ""
command_verify_key = ""
data_dir = "${DATA_DIR}"
EOF
  if [ -n "${NODERAIL_REGION:-}" ]; then
    printf 'region = "%s"\n' "${NODERAIL_REGION}" >> "${CONFIG_PATH}"
  fi
  printf '\n[labels]\n' >> "${CONFIG_PATH}"
fi
chown "${AGENT_USER}:${AGENT_USER}" "${CONFIG_PATH}"
chmod 0600 "${CONFIG_PATH}"

# ---- 4. register (if not already) ------------------------------------------
if grep -q 'node_id = ""' "${CONFIG_PATH}"; then
  log "registering node with the control plane"
  region_arg=""
  if [ -n "${NODERAIL_REGION:-}" ]; then
    region_arg="--region ${NODERAIL_REGION}"
  fi
  # Run as the agent user so file ownership stays correct.
  # shellcheck disable=SC2086
  sudo -u "${AGENT_USER}" "${BIN_PATH}" register \
    --api-url "${NODERAIL_API_URL}" \
    --join-token "${NODERAIL_JOIN_TOKEN}" \
    --name "${NODE_NAME}" \
    --config "${CONFIG_PATH}" \
    ${region_arg}
else
  log "node already registered; skipping join"
fi

# ---- 5. systemd unit --------------------------------------------------------
log "installing systemd unit"
if [ -f "${SCRIPT_DIR}/../systemd/${SERVICE_NAME}.service" ]; then
  install -m 0644 "${SCRIPT_DIR}/../systemd/${SERVICE_NAME}.service" "${UNIT_PATH}"
else
  err "systemd unit template not found next to installer"
  exit 1
fi

log "enabling and starting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

log "done. Check status with: systemctl status ${SERVICE_NAME}"
