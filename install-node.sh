#!/usr/bin/env bash
# Tifusi node-agent installer — for a server that actually runs Xray-core
# and takes config pushes from a Tifusi Panel running elsewhere. Create the
# node from the panel's Nodes page first (+ نود جدید) to get its API key.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install-node.sh)" -- <API_KEY> [PORT]

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
CLONE_DIR="$(mktemp -d)"
trap 'rm -rf "$CLONE_DIR"' EXIT

info() { printf '\033[1;36m[تیفوسی نود]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[خطا]\033[0m %s\n' "$1"; exit 1; }

command -v docker >/dev/null 2>&1 \
  || fail "داکر نصب نیست. اول این رو اجرا کن: curl -fsSL https://get.docker.com | sh"

API_KEY="${1:-${TIFUSI_NODE_API_KEY:-}}"
PORT="${2:-62050}"

if [ -z "$API_KEY" ]; then
  read -r -p "API Key نود (از پنل، تب «نودها»، بعد از ساختن نود): " API_KEY
fi
[ -n "$API_KEY" ] || fail "بدون API Key نمی‌شه ادامه داد."

info "دانلود سورس..."
git clone --depth 1 "$REPO_URL" "$CLONE_DIR" >/dev/null

info "ساخت ایمیج نود (شامل دانلود باینری واقعی Xray-core)..."
docker build -t tifusi-node-agent -f "$CLONE_DIR/backend/node_agent/Dockerfile" "$CLONE_DIR/backend"

if docker ps -a --format '{{.Names}}' | grep -qx tifusi-node; then
  info "یه کانتینر با اسم tifusi-node از قبل هست، جایگزینش می‌کنم..."
  docker rm -f tifusi-node >/dev/null
fi

info "اجرای نود رو پورت $PORT..."
docker run -d --name tifusi-node --restart unless-stopped \
  -p "${PORT}:62050" -e "TIFUSI_NODE_API_KEY=${API_KEY}" tifusi-node-agent

info "نود بالا اومد. حالا از داخل پنل، تب «نودها»، رو همین نود بزن Sync."
