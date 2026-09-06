#!/usr/bin/env bash
# Tifusi node-agent installer — for a server that actually runs Xray-core
# and takes config pushes from a Tifusi Panel running elsewhere. Create the
# node from the panel's Nodes page first (+ node) to get its API key.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

info() { printf '\033[1;36m[Tifusi Node]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[Warning]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[Error]\033[0m %s\n' "$1"; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  info "Docker isn't installed — installing it with the official script (curl -fsSL https://get.docker.com | sh)..."
  curl -fsSL https://get.docker.com | sh
  command -v docker >/dev/null 2>&1 \
    || fail "Automatic Docker install failed — try it manually: curl -fsSL https://get.docker.com | sh"
fi

API_KEY="${1:-${TIFUSI_NODE_API_KEY:-}}"
PORT="${2:-62050}"

if [ -z "$API_KEY" ]; then
  read -r -p "Node API key (from the panel's Nodes tab, after creating the node): " API_KEY
fi
[ -n "$API_KEY" ] || fail "Can't continue without an API key."

info "Downloading source..."
git clone --depth 1 "$REPO_URL" "$CLONE_DIR" >/dev/null

info "Building the node image (downloads the real Xray-core binary)..."
BUILD_LOG="$(mktemp)"
if ! docker build -t tifusi-node-agent -f "$CLONE_DIR/backend/node_agent/Dockerfile" "$CLONE_DIR/backend" > "$BUILD_LOG" 2>&1; then
  warn "Build failed — full output:"
  cat "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
  info "A container named tifusi-node already exists, replacing it..."
  docker rm -f tifusi-node >/dev/null
fi

info "Starting the node on the host's real network (agent on port $PORT)..."
# --network host, not -p per port: Xray binds to whatever proxy ports the
# panel's pushed config gives it, decided AFTER this container starts, and
# Docker can't pre-publish a port it doesn't know about yet. Host networking
# means every port Xray (or the agent) binds to is reachable directly,
# exactly like PasarGuard's own node containers.
docker run -d --name tifusi-node --restart unless-stopped \
  --network host -e "TIFUSI_NODE_API_KEY=${API_KEY}" -e "AGENT_PORT=${PORT}" tifusi-node-agent

info "Node is up. Now hit Sync on it from the panel's Nodes tab."
