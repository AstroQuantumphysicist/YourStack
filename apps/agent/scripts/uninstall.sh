#!/bin/sh
# NodeRail agent uninstaller. Stops and disables the service, then removes the
# binary, unit, config, and system user. Data directory removal is opt-in.
#
#   PURGE_DATA=1 ./uninstall.sh    # also delete /var/lib/noderail
set -eu

BIN_PATH="/usr/local/bin/noderail-agent"
CONFIG_DIR="/etc/noderail"
DATA_DIR="/var/lib/noderail"
SERVICE_NAME="noderail-agent"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_USER="noderail"

log() { printf '\033[1;34m[uninstall]\033[0m %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  printf 'must run as root (try: sudo %s)\n' "$0" >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files | grep -q "${SERVICE_NAME}.service"; then
    log "stopping and disabling ${SERVICE_NAME}"
    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  fi
fi

if [ -f "${UNIT_PATH}" ]; then
  log "removing systemd unit"
  rm -f "${UNIT_PATH}"
  systemctl daemon-reload 2>/dev/null || true
fi

if [ -f "${BIN_PATH}" ]; then
  log "removing binary"
  rm -f "${BIN_PATH}"
fi

if [ -d "${CONFIG_DIR}" ]; then
  log "removing config"
  rm -rf "${CONFIG_DIR}"
fi

if [ "${PURGE_DATA:-0}" = "1" ] && [ -d "${DATA_DIR}" ]; then
  log "purging data directory ${DATA_DIR}"
  rm -rf "${DATA_DIR}"
else
  log "leaving data directory ${DATA_DIR} (set PURGE_DATA=1 to remove)"
fi

if id "${AGENT_USER}" >/dev/null 2>&1; then
  log "removing user ${AGENT_USER}"
  userdel "${AGENT_USER}" 2>/dev/null || true
fi

log "done."
