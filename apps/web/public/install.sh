#!/bin/sh
# ============================================================================
# YourStack node bootstrap
#
# Turns any Linux server into a YourStack node by downloading and running the
# agent installer. The control plane references this script as
# ${PUBLIC_WEB_URL}/install.sh and hands you a ready-to-paste command:
#
#   curl -fsSL https://app.yourstack.com/install.sh \
#     | YOURSTACK_API_URL="https://api.yourstack.com" \
#       YOURSTACK_JOIN_TOKEN="ysj_..." sh
#
# Requirements: a POSIX shell, curl, and Docker on the target host.
# ============================================================================

set -eu

YOURSTACK_API_URL="${YOURSTACK_API_URL:-}"
YOURSTACK_JOIN_TOKEN="${YOURSTACK_JOIN_TOKEN:-}"
# Where the platform publishes the agent installer. Override for self-hosting.
YOURSTACK_AGENT_INSTALLER="${YOURSTACK_AGENT_INSTALLER:-${YOURSTACK_API_URL}/agent/install.sh}"

log()  { printf '\033[1;35m[yourstack]\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m[yourstack] error:\033[0m %s\n' "$1" >&2; }
die()  { err "$1"; exit 1; }

# --- Preconditions --------------------------------------------------------
[ -n "$YOURSTACK_API_URL" ]    || die "YOURSTACK_API_URL is required (e.g. https://api.yourstack.com)"
[ -n "$YOURSTACK_JOIN_TOKEN" ] || die "YOURSTACK_JOIN_TOKEN is required (create one in the dashboard: Nodes -> Join a node)"

command -v curl >/dev/null 2>&1 || die "curl is required but was not found"

if ! command -v docker >/dev/null 2>&1; then
  err "Docker was not found on this host."
  err "Install Docker first: https://docs.docker.com/engine/install/ then re-run this command."
  exit 1
fi

log "Bootstrapping YourStack agent"
log "  control plane : ${YOURSTACK_API_URL}"
log "  installer      : ${YOURSTACK_AGENT_INSTALLER}"

# --- Fetch + run the agent installer --------------------------------------
# Download to a temp file first so a partial download never executes.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -fsSL "$YOURSTACK_AGENT_INSTALLER" -o "$tmp"; then
  err "Could not download the agent installer from ${YOURSTACK_AGENT_INSTALLER}"
  err "Verify YOURSTACK_API_URL is reachable from this host, or set YOURSTACK_AGENT_INSTALLER."
  exit 1
fi

log "Running agent installer..."
# The agent installer registers this machine using the one-time join token and
# starts the agent service (heartbeats + command polling).
YOURSTACK_API_URL="$YOURSTACK_API_URL" \
YOURSTACK_JOIN_TOKEN="$YOURSTACK_JOIN_TOKEN" \
  sh "$tmp"

log "Done. This node should appear in your workspace shortly."
