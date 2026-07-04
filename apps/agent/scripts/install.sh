#!/bin/sh
# YourStack agent installer.
#
# Idempotent install of the yourstack-agent binary, a dedicated system user, the
# on-disk config, and the systemd unit. Re-running it upgrades the binary and
# re-applies configuration without duplicating state.
#
# Required environment:
#   YOURSTACK_API_URL     Base URL of the control-plane API.
#   YOURSTACK_JOIN_TOKEN  One-time join token (ysj_...) from the dashboard/CLI.
# Optional environment:
#   YOURSTACK_NODE_NAME   Node display name (default: the machine hostname).
#   YOURSTACK_REGION      Region label.
#   YOURSTACK_RUNTIME     Container runtime: "docker" (default) or "podman".
#   YOURSTACK_ENGINE_SOCKET  Explicit Engine API socket/URL override.
#   YOURSTACK_BINARY_URL  URL to download the prebuilt binary from. If unset, the
#                        script expects ./yourstack-agent next to this script or an
#                        already-installed binary on PATH.
set -eu

# ---- config -----------------------------------------------------------------
PREFIX="/usr/local/bin"
BIN_PATH="${PREFIX}/yourstack-agent"
CONFIG_DIR="/etc/yourstack"
CONFIG_PATH="${CONFIG_DIR}/agent.toml"
DATA_DIR="/var/lib/yourstack"
SERVICE_NAME="yourstack-agent"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_USER="yourstack"
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
  : "${YOURSTACK_API_URL:?set YOURSTACK_API_URL}"
  : "${YOURSTACK_JOIN_TOKEN:?set YOURSTACK_JOIN_TOKEN}"
}

require_root
require_env

NODE_NAME="${YOURSTACK_NODE_NAME:-$(hostname)}"
RUNTIME="${YOURSTACK_RUNTIME:-docker}"
case "${RUNTIME}" in
  docker|podman) ;;
  *) err "YOURSTACK_RUNTIME must be 'docker' or 'podman' (got '${RUNTIME}')"; exit 1 ;;
esac

# Where to fetch the agent binary. By default the control plane serves a matching
# prebuilt binary at /agent/download/<os>/<arch>; override for air-gapped hosts.
if [ -z "${YOURSTACK_BINARY_URL:-}" ] && [ -n "${YOURSTACK_API_URL:-}" ]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  YOURSTACK_BINARY_URL="${YOURSTACK_API_URL%/}/agent/download/${os}/${arch}"
fi

# ---- 1. system user ---------------------------------------------------------
if id "${AGENT_USER}" >/dev/null 2>&1; then
  log "user ${AGENT_USER} already exists"
else
  log "creating system user ${AGENT_USER}"
  useradd --system --no-create-home --shell /usr/sbin/nologin "${AGENT_USER}"
fi

# Grant container-engine access for the chosen runtime.
if [ "${RUNTIME}" = "podman" ]; then
  if ! command -v podman >/dev/null 2>&1; then
    err "podman not found — install Podman so the agent can manage containers"
  fi
  # Enable the rootful Podman API socket the agent connects to.
  if command -v systemctl >/dev/null 2>&1; then
    log "enabling podman.socket (rootful Engine API)"
    systemctl enable --now podman.socket >/dev/null 2>&1 || \
      err "could not enable podman.socket — enable it manually so the agent can connect"
  fi
  # The rootful socket lives under the podman group when present.
  if getent group podman >/dev/null 2>&1; then
    log "adding ${AGENT_USER} to podman group"
    usermod -aG podman "${AGENT_USER}"
  fi
else
  if getent group docker >/dev/null 2>&1; then
    log "adding ${AGENT_USER} to docker group"
    usermod -aG docker "${AGENT_USER}"
  else
    err "docker group not found — install Docker so the agent can manage containers"
  fi
fi

# ---- 2. binary --------------------------------------------------------------
install_binary() {
  if [ -n "${YOURSTACK_BINARY_URL:-}" ]; then
    log "downloading binary from ${YOURSTACK_BINARY_URL}"
    tmp="$(mktemp)"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "${YOURSTACK_BINARY_URL}" -o "${tmp}"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "${tmp}" "${YOURSTACK_BINARY_URL}"
    else
      err "need curl or wget to download the binary"
      exit 1
    fi
    install -m 0755 "${tmp}" "${BIN_PATH}"
    rm -f "${tmp}"
  elif [ -f "${SCRIPT_DIR}/yourstack-agent" ]; then
    log "installing bundled binary"
    install -m 0755 "${SCRIPT_DIR}/yourstack-agent" "${BIN_PATH}"
  elif [ -f "${BIN_PATH}" ]; then
    log "reusing existing binary at ${BIN_PATH}"
  else
    err "no binary found: set YOURSTACK_BINARY_URL or place yourstack-agent next to this script"
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
api_url = "${YOURSTACK_API_URL}"
node_id = ""
agent_token = ""
command_verify_key = ""
data_dir = "${DATA_DIR}"
runtime = "${RUNTIME}"
EOF
  if [ -n "${YOURSTACK_ENGINE_SOCKET:-}" ]; then
    printf 'engine_socket = "%s"\n' "${YOURSTACK_ENGINE_SOCKET}" >> "${CONFIG_PATH}"
  fi
  if [ -n "${YOURSTACK_REGION:-}" ]; then
    printf 'region = "%s"\n' "${YOURSTACK_REGION}" >> "${CONFIG_PATH}"
  fi
  printf '\n[labels]\n' >> "${CONFIG_PATH}"
fi
chown "${AGENT_USER}:${AGENT_USER}" "${CONFIG_PATH}"
chmod 0600 "${CONFIG_PATH}"

# ---- 4. register (if not already) ------------------------------------------
if grep -q 'node_id = ""' "${CONFIG_PATH}"; then
  log "registering node with the control plane"
  region_arg=""
  if [ -n "${YOURSTACK_REGION:-}" ]; then
    region_arg="--region ${YOURSTACK_REGION}"
  fi
  socket_arg=""
  if [ -n "${YOURSTACK_ENGINE_SOCKET:-}" ]; then
    socket_arg="--engine-socket ${YOURSTACK_ENGINE_SOCKET}"
  fi
  # Run as the agent user so file ownership stays correct.
  # shellcheck disable=SC2086
  sudo -u "${AGENT_USER}" "${BIN_PATH}" register \
    --api-url "${YOURSTACK_API_URL}" \
    --join-token "${YOURSTACK_JOIN_TOKEN}" \
    --name "${NODE_NAME}" \
    --config "${CONFIG_PATH}" \
    --runtime "${RUNTIME}" \
    ${region_arg} ${socket_arg}
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
