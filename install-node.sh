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

# Only emit color/box-drawing escapes into a real, color-capable terminal —
# piped into a log file or a dumb terminal, raw escape codes are exactly
# the "garbled unclear lines" this is here to avoid.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_CYAN=$'\033[1;36m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

info() { printf '%s[Tifusi Node]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

banner() {
  local title=" TIFUSI NODE " line
  line=$(printf '%*s' "${#title}" '' | tr ' ' '=')
  printf '\n%s+%s+\n|%s|\n+%s+%s\n\n' "$C_CYAN" "$line" "$title" "$line" "$C_RESET"
}

banner

if ! command -v docker >/dev/null 2>&1; then
  info "Docker isn't installed — installing it with the official script..."
  DOCKER_INSTALL_LOG="$(mktemp)"
  if ! curl -fsSL https://get.docker.com | sh > "$DOCKER_INSTALL_LOG" 2>&1; then
    warn "Docker's own installer output:"
    cat "$DOCKER_INSTALL_LOG"
  fi
  rm -f "$DOCKER_INSTALL_LOG"
  command -v docker >/dev/null 2>&1 \
    || fail "Automatic Docker install failed — try it manually: curl -fsSL https://get.docker.com | sh"
fi

API_KEY="${1:-${TIFUSI_NODE_API_KEY:-}}"
PORT="${2:-62050}"

if [ -z "$API_KEY" ]; then
  read -r -p "Node API key (from the panel's Nodes tab, after creating the node): " API_KEY
fi
[ -n "$API_KEY" ] || fail "Can't continue without an API key."

# Prebuilt (by .github/workflows/build-images.yml) beats building locally —
# this Dockerfile compiles strongSwan from source for EAP-MSCHAPv2 support,
# which on a small single-vCPU VPS is several minutes of single-threaded
# compilation every single install. Falls back to a real local build (and
# the git clone it needs) if the pull fails — offline registry, a fork
# with no images published yet, or this repo's Packages not made Public.
PREBUILT_IMAGE="ghcr.io/javadtifusi-eng/tifusi-node-agent:latest"
info "Trying the prebuilt node image first (faster than compiling strongSwan locally)..."
if docker pull "$PREBUILT_IMAGE" >/dev/null 2>&1; then
  docker tag "$PREBUILT_IMAGE" tifusi-node-agent
  info "Pulled the prebuilt node image."
else
  info "Prebuilt image unavailable — building locally instead. This compiles strongSwan from source and can take several minutes."
  info "Downloading source..."
  git clone --depth 1 "$REPO_URL" "$CLONE_DIR" >/dev/null

  BUILD_LOG="$(mktemp)"
  if ! docker build -t tifusi-node-agent -f "$CLONE_DIR/backend/node_agent/Dockerfile" "$CLONE_DIR/backend" > "$BUILD_LOG" 2>&1; then
    warn "Build failed — full output:"
    cat "$BUILD_LOG"
    rm -f "$BUILD_LOG"
    exit 1
  fi
  rm -f "$BUILD_LOG"
fi

if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
  info "A container named tifusi-node already exists, replacing it..."
  docker rm -f tifusi-node >/dev/null
fi

# l2tp_ppp/ppp_generic: xl2tpd needs these loaded into the HOST kernel to
# actually create L2TP/PPP sessions — a container can't load kernel
# modules into a kernel it doesn't own, so this has to happen out here,
# not inside the Dockerfile/container. `|| true` because a kernel that
# already has these built in (not as modules) has nothing to modprobe,
# and that's not a failure. ppp_generic is what actually owns /dev/ppp —
# confirmed live that a kernel can have l2tp_ppp loaded and still lack
# this, since it's what registers the character device, not l2tp_ppp.
modprobe l2tp_ppp 2>/dev/null || true
modprobe ppp_generic 2>/dev/null || true
# Some hosts' kernels create /dev/ppp via udev only, which a minimal VPS
# image may not be running — recreate it by hand (major/minor 108:0 is
# the kernel-assigned, unchanging device number for /dev/ppp) if loading
# the module alone didn't produce it.
[ -e /dev/ppp ] || mknod -m 600 /dev/ppp c 108 0 2>/dev/null || true

info "Starting the node on the host's real network (agent on port $PORT)..."
# --network host, not -p per port: Xray binds to whatever proxy ports the
# panel's pushed config gives it, decided AFTER this container starts, and
# Docker can't pre-publish a port it doesn't know about yet. Host networking
# means every port Xray (or the agent) binds to is reachable directly,
# without having to predict and republish them one by one.
#
# NET_ADMIN/NET_RAW: only needed if the panel later assigns this node an
# l2tp/ikev2 Core — strongSwan/xl2tpd need them to touch IPsec kernel state
# and manage PPP interfaces. Harmless for a plain Xray node, so it's just
# always granted rather than making this script guess in advance.
EXTRA_DOCKER_ARGS=(--cap-add=NET_ADMIN --cap-add=NET_RAW)
if [ -d /lib/modules ]; then
  EXTRA_DOCKER_ARGS+=(-v /lib/modules:/lib/modules:ro)
fi
# /dev/ppp: xl2tpd/pppd need this character device to create PPP
# interfaces at all — Docker doesn't pass host devices into a container
# by default, so without this xl2tpd fails even once the host kernel has
# every l2tp/ppp module loaded (confirmed live, this exact gap).
if [ -e /dev/ppp ]; then
  EXTRA_DOCKER_ARGS+=(--device=/dev/ppp:/dev/ppp)
fi

docker run -d --name tifusi-node --restart unless-stopped \
  --network host "${EXTRA_DOCKER_ARGS[@]}" \
  -e "TIFUSI_NODE_API_KEY=${API_KEY}" -e "AGENT_PORT=${PORT}" tifusi-node-agent

info "Node is up. Now hit Sync on it from the panel's Nodes tab."
