#!/usr/bin/env bash
# Tifusi Panel installer — clones the repo and brings the panel up with
# Docker Compose. The admin account itself is created from the browser's
# login page, using a one-time key from `tifusi-cli generate-admin-key` —
# this script just gets the panel running and hands you that command.
#
# Usage:
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/javadtifusi-eng/Tifusi-Panel/main/install.sh)"

set -euo pipefail

REPO_URL="https://github.com/javadtifusi-eng/Tifusi-Panel.git"
INSTALL_DIR="${TIFUSI_INSTALL_DIR:-/opt/tifusi-panel}"
# Set for real in the "Ports" step below, once the chosen panel port is known.
PANEL_URL=""

# Only emit color/box-drawing escapes into a real, color-capable terminal —
# piped into a log file or a dumb terminal, raw escape codes are exactly
# the "garbled unclear lines" this is here to avoid.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_CYAN=$'\033[1;36m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_RESET=""; C_BOLD=""
fi

info() { printf '%s[Tifusi]%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s[Warning]%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s[Error]%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

# One line per install phase (system deps, docker, repo, .env, SSL, build,
# health check) — a percentage instead of a bare step count so a long build
# still reads as visible progress rather than a silent hang.
STEP_TOTAL=8
STEP_NUM=0
step() {
  STEP_NUM=$((STEP_NUM + 1))
  printf '%s[%d/%d · %d%%]%s %s\n' "$C_CYAN" "$STEP_NUM" "$STEP_TOTAL" $((STEP_NUM * 100 / STEP_TOTAL)) "$C_RESET" "$1"
}

banner() {
  # Kept narrow on purpose (~20 cols) despite wanting to stand out more —
  # a wider box wraps mid-line on a narrow terminal (a phone SSH client,
  # for instance) and comes out looking like garbled rows of "=" instead
  # of a box. Extra blank padding rows plus bold/colored title text make
  # it read as bigger without widening it.
  local title="TIFUSI PANEL" text width bar blank
  text="   ${title}   "
  width=${#text}
  bar=$(printf '%*s' "$width" '' | tr ' ' '=')
  blank=$(printf '%*s' "$width" '')
  printf '\n%s+%s+\n' "$C_CYAN" "$bar"
  printf '|%s|\n' "$blank"
  printf '|%s%s%s%s|\n' "$C_YELLOW" "$C_BOLD" "$text" "$C_RESET$C_CYAN"
  printf '|%s|\n' "$blank"
  printf '+%s+%s\n\n' "$bar" "$C_RESET"
}

banner
info "Installing Tifusi Panel..."

step "System packages"
if command -v apt-get >/dev/null 2>&1; then
  info "Updating the system's package list (apt-get update)..."
  DEBIAN_FRONTEND=noninteractive apt-get update -y >/dev/null 2>&1 || warn "apt-get update failed — continuing anyway."
fi

step "Docker"
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
docker compose version >/dev/null 2>&1 \
  || fail "Docker is installed but the docker compose plugin isn't (or is too old) — update Docker."

step "Repository"
if [ -f "docker-compose.yml" ] && [ -d "backend" ] && [ -d "frontend" ]; then
  INSTALL_DIR="$(pwd)"
  info "Installing from the current directory ($INSTALL_DIR)."
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Repo already exists at $INSTALL_DIR, updating it..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning the repo into $INSTALL_DIR..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

step "Configuration (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  awk -v s="$SECRET" '{gsub(/^TIFUSI_SECRET_KEY=.*/, "TIFUSI_SECRET_KEY=" s)}1' .env > .env.tmp
  mv .env.tmp .env
  info "Generated a random TIFUSI_SECRET_KEY in .env."
fi

step "Ports"
# A port already in use on this server would make the container fail to
# start later with a confusing Docker error — check now instead, and if
# the caller just hits Enter (wants the default), pick the next free port
# starting from it rather than blindly handing back something taken.
port_in_use() {
  (command -v ss >/dev/null 2>&1 && ss -tlnH "( sport = :$1 )" 2>/dev/null | grep -q .) \
    || (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1)
}
next_free_port() {
  local p="$1"
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

read -r -p "Panel API port (Enter to auto-pick, starting from 8000): " panel_port
if [ -z "$panel_port" ]; then
  panel_port=$(next_free_port 8000)
  info "Auto-picked port $panel_port for the panel API."
elif port_in_use "$panel_port"; then
  warn "Port $panel_port is already in use on this server — pick a different one."
  read -r -p "Panel API port: " panel_port
fi

read -r -p "Dashboard (web UI) port (Enter to auto-pick, starting from 8080): " dashboard_port
if [ -z "$dashboard_port" ]; then
  dashboard_port=$(next_free_port 8080)
  info "Auto-picked port $dashboard_port for the dashboard."
elif port_in_use "$dashboard_port"; then
  warn "Port $dashboard_port is already in use on this server — pick a different one."
  read -r -p "Dashboard port: " dashboard_port
fi
awk -v p="$panel_port" -v d="$dashboard_port" '
  /^TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
  /^# TIFUSI_PANEL_PORT=/ { print "TIFUSI_PANEL_PORT=" p; next }
  /^TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
  /^# TIFUSI_DASHBOARD_PORT=/ { print "TIFUSI_DASHBOARD_PORT=" d; next }
  { print }
' .env > .env.tmp
grep -q '^TIFUSI_PANEL_PORT=' .env.tmp || echo "TIFUSI_PANEL_PORT=$panel_port" >> .env.tmp
grep -q '^TIFUSI_DASHBOARD_PORT=' .env.tmp || echo "TIFUSI_DASHBOARD_PORT=$dashboard_port" >> .env.tmp
mv .env.tmp .env
PANEL_URL="http://localhost:${panel_port}"
info "Panel API on port $panel_port, dashboard on port $dashboard_port."

step "SSL / domain"
read -r -p "Do you have a domain name pointing at this server? [y/N] " has_domain
has_domain=${has_domain:-N}
if [[ "$has_domain" =~ ^[Yy]$ ]]; then
  read -r -p "Domain (e.g. panel.example.com): " domain
  if [ -n "$domain" ]; then
    read -r -p "Get a free Let's Encrypt certificate for it now? [Y/n] " get_cert
    get_cert=${get_cert:-Y}
    if [[ "$get_cert" =~ ^[Yy]$ ]]; then
      info "Requesting a Let's Encrypt certificate for $domain (needs port 80 free, and $domain must already resolve to this server)..."
      mkdir -p certs letsencrypt-work
      CERT_LOG="$(mktemp)"
      if docker run --rm -p 80:80 -v "$(pwd)/letsencrypt-work:/etc/letsencrypt" \
        certbot/certbot certonly --standalone --non-interactive --agree-tos \
        -m "admin@${domain}" -d "$domain" > "$CERT_LOG" 2>&1; then
        cp "letsencrypt-work/live/${domain}/fullchain.pem" certs/fullchain.pem
        cp "letsencrypt-work/live/${domain}/privkey.pem" certs/privkey.pem
        echo "TIFUSI_PUBLIC_URL=https://${domain}" >> .env
        PANEL_PUBLIC_URL="https://${domain}"
        info "Certificate obtained — the dashboard (login page) will serve HTTPS directly on $PANEL_PUBLIC_URL."
        warn "Let's Encrypt certificates expire every 90 days — this installer doesn't set up auto-renewal, so you'll need to repeat this (or set up certbot renew plus a container restart) before then."
      else
        warn "Certificate request failed — full output:"
        cat "$CERT_LOG"
        warn "Continuing without TLS (check that port 80 is free and $domain really resolves to this server's IP)."
      fi
      rm -f "$CERT_LOG"
    fi
  fi
fi
PANEL_PUBLIC_URL="${PANEL_PUBLIC_URL:-}"

step "Building & starting containers"
BUILD_LOG="$(mktemp)"
info "Trying prebuilt images first (faster than building locally, especially on a low-core server)..."
if docker compose pull > "$BUILD_LOG" 2>&1; then
  info "Pulled prebuilt images."
  BUILD_CMD=(docker compose up -d)
else
  info "Prebuilt images aren't available (offline registry, or this repo's Packages aren't Public yet) — building locally instead. This can take a few minutes."
  BUILD_CMD=(docker compose up -d --build)
fi
if ! "${BUILD_CMD[@]}" > "$BUILD_LOG" 2>&1; then
  warn "Build failed — full output:"
  cat "$BUILD_LOG"
  rm -f "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

step "Health check"
info "Waiting for the panel to come up..."
ready=""
for _ in $(seq 1 60); do
  if curl -fsSk "$PANEL_URL/api/setup/status" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ -n "$ready" ] || fail "The panel didn't come up in time — check the logs: docker compose logs panel"

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-<server-ip>}"
info "The panel is up."
if [ -n "$PANEL_PUBLIC_URL" ]; then
  info "  SSL:        enabled (Let's Encrypt, ${domain:-})"
  info "  Certs:      ${INSTALL_DIR}/certs/fullchain.pem + privkey.pem"
  info "  Dashboard:  $PANEL_PUBLIC_URL"
else
  info "  Dashboard:  http://${HOST_IP}:${dashboard_port}"
fi
info "  Panel API:  http://${HOST_IP}:${panel_port}"
info ""
info "To create the admin account, open the dashboard in your browser, then run this to get a one-time setup key:"
info "  docker exec -it tifusi-panel tifusi-cli generate-admin-key"
info "Paste that key into the login page along with the username/password you want, and you're in."
info "Done."
