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
else
  C_CYAN=""; C_YELLOW=""; C_RED=""; C_RESET=""
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
  local title=" TIFUSI PANEL " line
  line=$(printf '%*s' "${#title}" '' | tr ' ' '=')
  printf '\n%s+%s+\n|%s|\n+%s+%s\n\n' "$C_CYAN" "$line" "$title" "$line" "$C_RESET"
}

# A single labeled box, sized to its own content — used for the SSL summary
# at the end so it actually stands out from the surrounding plain info lines
# instead of blending into a wall of text.
box() {
  local label="$1" value="$2" content width bar
  content="  ${label}: ${value}  "
  width=${#content}
  bar=$(printf '%*s' "$width" '' | tr ' ' '=')
  printf '%s+%s+\n|%s|\n+%s+%s\n' "$C_CYAN" "$bar" "$content" "$bar" "$C_RESET"
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
read -r -p "Panel API port [8000]: " panel_port
panel_port=${panel_port:-8000}
read -r -p "Dashboard (web UI) port [8080]: " dashboard_port
dashboard_port=${dashboard_port:-8080}
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
info "Bringing the panel up with Docker Compose (this can take a few minutes)..."
BUILD_LOG="$(mktemp)"
if ! docker compose up -d --build > "$BUILD_LOG" 2>&1; then
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
  printf '\n'
  box "SSL" "enabled (Let's Encrypt, ${domain:-})"
  box "Certificate path" "${INSTALL_DIR}/certs/fullchain.pem + privkey.pem"
  printf '\n'
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
